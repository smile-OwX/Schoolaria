#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_512 = path.join(ROOT, 'public', 'pwa-512x512.png');
const SOURCE_192 = path.join(ROOT, 'public', 'pwa-192x192.png');
const BUILD_DIR = path.join(ROOT, 'build');
const OUTPUT_ICO = path.join(BUILD_DIR, 'icon.ico');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(sig)) {
    throw new Error('Source icon is not a valid PNG file.');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idatChunks = [];

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(`Unsupported PNG format (depth=${bitDepth}, colorType=${colorType}).`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * 4);
  const prevRow = Buffer.alloc(stride);
  const currRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];

    for (let x = 0; x < stride; x++) {
      const val = raw[rowStart + 1 + x];
      const left = x >= bpp ? currRow[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;

      if (filter === 0) currRow[x] = val;
      else if (filter === 1) currRow[x] = (val + left) & 0xff;
      else if (filter === 2) currRow[x] = (val + up) & 0xff;
      else if (filter === 3) currRow[x] = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) currRow[x] = (val + paethPredictor(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter type ${filter}`);
    }

    for (let px = 0; px < width; px++) {
      const srcIdx = px * bpp;
      const dstIdx = (y * width + px) * 4;
      rgba[dstIdx] = currRow[srcIdx];
      rgba[dstIdx + 1] = currRow[srcIdx + 1];
      rgba[dstIdx + 2] = currRow[srcIdx + 2];
      rgba[dstIdx + 3] = bpp === 4 ? currRow[srcIdx + 3] : 255;
    }
    currRow.copy(prevRow);
  }

  return { width, height, rgba };
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // non-interlaced

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // None filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function resizeRgba(src, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return Buffer.from(src);
  const dst = Buffer.alloc(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.floor((x + 1) * scaleX)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * srcW + sx) * 4;
          const alpha = src[i + 3];
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += alpha;
          count++;
        }
      }

      const o = (y * dstW + x) * 4;
      if (a > 0 && count > 0) {
        dst[o] = Math.round(r / a);
        dst[o + 1] = Math.round(g / a);
        dst[o + 2] = Math.round(b / a);
        dst[o + 3] = Math.round(a / count);
      }
    }
  }
  return dst;
}

function buildRoundedIconRgba(src, srcW, srcH, dstW, dstH) {
  const resized = resizeRgba(src, srcW, srcH, dstW, dstH);
  const cx = (dstW - 1) / 2;
  const cy = (dstH - 1) / 2;
  const radius = Math.min(dstW, dstH) / 2 - 0.5;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > radius + 0.5) {
        const idx = (y * dstW + x) * 4;
        resized[idx + 3] = 0;
      } else if (dist > radius - 0.5) {
        const idx = (y * dstW + x) * 4;
        const factor = Math.max(0, Math.min(1, radius + 0.5 - dist));
        resized[idx + 3] = Math.round(resized[idx + 3] * factor);
      }
    }
  }
  return resized;
}

function buildPaddedForegroundRgba(src, srcW, srcH, canvasSize) {
  const canvas = Buffer.alloc(canvasSize * canvasSize * 4);
  const innerSize = Math.max(16, Math.round(canvasSize * 0.64));
  const inner = resizeRgba(src, srcW, srcH, innerSize, innerSize);
  const offset = Math.floor((canvasSize - innerSize) / 2);

  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const s = (y * innerSize + x) * 4;
      const d = ((y + offset) * canvasSize + (x + offset)) * 4;
      canvas[d] = inner[s];
      canvas[d + 1] = inner[s + 1];
      canvas[d + 2] = inner[s + 2];
      canvas[d + 3] = inner[s + 3];
    }
  }
  return canvas;
}

function buildIcoFromPngs(entries) {
  // entries: Array<{ size: number, png: Buffer }>
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let dataOffset = 6 + entries.length * 16;

  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[2] = 0; // color palette count
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(dataOffset, 12);
    dirEntries.push(dir);
    dataOffset += entry.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

function ensureWindowsIco(decoded512) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const sizes = [256, 128, 64, 48, 32, 16];
  const entries = sizes.map((size) => {
    const rgba = resizeRgba(decoded512.rgba, decoded512.width, decoded512.height, size, size);
    return { size, png: encodePngRgba(size, size, rgba) };
  });
  const icoBuffer = buildIcoFromPngs(entries);
  fs.writeFileSync(OUTPUT_ICO, icoBuffer);
  console.log(`[OK] Icône Windows générée : ${path.relative(ROOT, OUTPUT_ICO)} (${icoBuffer.length} octets)`);
}

function ensureAndroidIcons(decoded512) {
  if (!fs.existsSync(ANDROID_RES)) {
    console.log('[INFO] Dossier android/app/src/main/res introuvable (ignorer si Android non initialisé).');
    return;
  }

  const densities = [
    { dir: 'mipmap-mdpi', launcher: 48, foreground: 108 },
    { dir: 'mipmap-hdpi', launcher: 72, foreground: 162 },
    { dir: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
    { dir: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
    { dir: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
  ];

  let updatedFiles = 0;
  for (const d of densities) {
    const mipmapDir = path.join(ANDROID_RES, d.dir);
    fs.mkdirSync(mipmapDir, { recursive: true });

    const squareRgba = resizeRgba(
      decoded512.rgba,
      decoded512.width,
      decoded512.height,
      d.launcher,
      d.launcher
    );
    fs.writeFileSync(
      path.join(mipmapDir, 'ic_launcher.png'),
      encodePngRgba(d.launcher, d.launcher, squareRgba)
    );
    updatedFiles++;

    const roundRgba = buildRoundedIconRgba(
      decoded512.rgba,
      decoded512.width,
      decoded512.height,
      d.launcher,
      d.launcher
    );
    fs.writeFileSync(
      path.join(mipmapDir, 'ic_launcher_round.png'),
      encodePngRgba(d.launcher, d.launcher, roundRgba)
    );
    updatedFiles++;

    const fgRgba = buildPaddedForegroundRgba(
      decoded512.rgba,
      decoded512.width,
      decoded512.height,
      d.foreground
    );
    fs.writeFileSync(
      path.join(mipmapDir, 'ic_launcher_foreground.png'),
      encodePngRgba(d.foreground, d.foreground, fgRgba)
    );
    updatedFiles++;
  }

  const valuesDir = path.join(ANDROID_RES, 'values');
  if (fs.existsSync(valuesDir)) {
    const bgXml = path.join(valuesDir, 'ic_launcher_background.xml');
    if (fs.existsSync(bgXml)) {
      fs.writeFileSync(
        bgXml,
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#4C1D95</color>\n</resources>\n',
        'utf8'
      );
      updatedFiles++;
    }
    const colorsXml = path.join(valuesDir, 'colors.xml');
    if (fs.existsSync(colorsXml)) {
      const current = fs.readFileSync(colorsXml, 'utf8');
      if (current.includes('ic_launcher_background')) {
        const next = current.replace(
          /<color name="ic_launcher_background">[^<]*<\/color>/,
          '<color name="ic_launcher_background">#4C1D95</color>'
        );
        fs.writeFileSync(colorsXml, next, 'utf8');
        updatedFiles++;
      }
    }
  }

  const drawableSplash = path.join(ANDROID_RES, 'drawable', 'splash.png');
  if (fs.existsSync(drawableSplash)) {
    fs.copyFileSync(SOURCE_512, drawableSplash);
    updatedFiles++;
  }

  console.log(`[OK] Icônes Android Schoolaria appliquées (${updatedFiles} fichiers mis à jour).`);
}

function main() {
  const sourcePath = fs.existsSync(SOURCE_512) ? SOURCE_512 : SOURCE_192;
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Aucun fichier icône source trouvé dans public/pwa-512x512.png.');
  }
  const decoded = decodePngRgba(fs.readFileSync(sourcePath));
  ensureWindowsIco(decoded);

  if (process.argv.includes('--android') || fs.existsSync(ANDROID_RES)) {
    ensureAndroidIcons(decoded);
  }
}

main();
