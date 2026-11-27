import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildApiUrlFromBase,
  isAllowedCorsOrigin,
  isSameHostOrigin,
  normalizeBaseUrl,
  requiresExternalApiUrlForTarget,
  resolveApiBaseUrl,
} from './apiUrl.ts';
import { formatFirebaseAuthErrorDetails } from './authErrors.ts';
import { filterChildrenForParent } from './parentHelpers.ts';
import {
  buildFixedSubjectsPreviewForClass,
  computeMoyClasse,
  computeMoyMatiere,
  computeNotificationExpiresAt,
  isNotificationExpired,
  isNotificationVisibleForUser,
  parseTogoClassProfile,
} from '../types/school.ts';
import type { Membership, Student } from '../types/school.ts';

test('normalizeBaseUrl normalizes Vercel URLs and rejects invalid schemes', () => {
  assert.equal(normalizeBaseUrl('https://mon-ecole.vercel.app///'), 'https://mon-ecole.vercel.app');
  assert.equal(normalizeBaseUrl('mon-ecole.vercel.app/'), 'https://mon-ecole.vercel.app');
  assert.equal(normalizeBaseUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), '');
  assert.equal(normalizeBaseUrl('   '), '');
});

test('resolveApiBaseUrl prioritizes savedUrl over envUrl and never defaults to AI Studio preview URL', () => {
  assert.equal(
    resolveApiBaseUrl({ savedUrl: 'https://schoolaria.vercel.app/', envUrl: 'https://other.vercel.app' }),
    'https://schoolaria.vercel.app'
  );
  assert.equal(
    resolveApiBaseUrl({ savedUrl: '', envUrl: 'https://schoolaria.vercel.app/' }),
    'https://schoolaria.vercel.app'
  );
  assert.equal(resolveApiBaseUrl({ savedUrl: '', envUrl: '' }), '');
});

test('requiresExternalApiUrlForTarget flags compiled shells when no server URL is configured', () => {
  assert.equal(
    requiresExternalApiUrlForTarget({
      protocol: 'capacitor:',
      isCompiledShell: true,
      resolvedBaseUrl: '',
    }),
    true
  );
  assert.equal(
    requiresExternalApiUrlForTarget({
      protocol: 'https:',
      isCompiledShell: true,
      resolvedBaseUrl: 'https://mon-ecole.vercel.app',
    }),
    false
  );
  assert.equal(
    requiresExternalApiUrlForTarget({
      protocol: 'https:',
      isCompiledShell: false,
      resolvedBaseUrl: '',
    }),
    false
  );
});

test('buildApiUrlFromBase formats full and relative API paths cleanly', () => {
  assert.equal(
    buildApiUrlFromBase('api/ai/chat-stream', 'https://mon-ecole.vercel.app/'),
    'https://mon-ecole.vercel.app/api/ai/chat-stream'
  );
  assert.equal(buildApiUrlFromBase('/api/health', ''), '/api/health');
});

test('isAllowedCorsOrigin allows Vercel, Capacitor, Electron, localhost, same-host custom domains, and blocks unknown origins', () => {
  assert.equal(isAllowedCorsOrigin('https://schoolaria-ecole.vercel.app'), true);
  assert.equal(isAllowedCorsOrigin('capacitor://localhost'), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:45821'), true);
  assert.equal(
    isAllowedCorsOrigin('https://portail.mon-lycee.tg', {
      ALLOWED_CORS_ORIGINS: 'https://portail.mon-lycee.tg',
    }),
    true
  );
  assert.equal(isSameHostOrigin('https://ecole.mon-domaine.tg', 'ecole.mon-domaine.tg'), true);
  assert.equal(
    isAllowedCorsOrigin('https://ecole.mon-domaine.tg', {}, 'ecole.mon-domaine.tg'),
    true
  );
  assert.equal(isAllowedCorsOrigin('https://evil-site.example.com', {}, 'ecole.mon-domaine.tg'), false);
  assert.equal(isAllowedCorsOrigin('https://evil-site.example.com'), false);
});

test('formatFirebaseAuthErrorDetails guides parents without Gmail on first connection', () => {
  const invalidMsg = formatFirebaseAuthErrorDetails('auth/invalid-credential', '');
  assert.match(invalidMsg, /1ère connexion/i);

  const invalidEmailMsg = formatFirebaseAuthErrorDetails('auth/invalid-email', '');
  assert.match(invalidEmailMsg, /yahoo|outlook/i);
});

test('filterChildrenForParent matches children via parentEmail even when activeMembership is null', () => {
  const students: Student[] = [
    {
      id: 'stu1',
      ownerId: 'u1',
      schoolId: 's1',
      matricule: 'M1',
      nom: 'ADJAHO',
      prenoms: 'Koffi',
      sexe: 'M',
      age: 12,
      cycle: 'Collège',
      classe: '6ème A',
      parentEmail: 'papa@yahoo.fr',
      status: 'actif',
    },
    {
      id: 'stu2',
      ownerId: 'u1',
      schoolId: 's1',
      matricule: 'M2',
      nom: 'LAWSON',
      prenoms: 'Afi',
      sexe: 'F',
      age: 13,
      cycle: 'Collège',
      classe: '5ème A',
      parentEmail: 'autre@outlook.com',
      status: 'actif',
    },
  ];

  const matchedByEmailOnly = filterChildrenForParent({
    students,
    activeMembership: null,
    parentEmail: 'PAPA@yahoo.fr',
    isPreview: false,
    activeOnly: true,
  });
  assert.equal(matchedByEmailOnly.length, 1);
  assert.equal(matchedByEmailOnly[0].id, 'stu1');

  const membership: Membership = {
    id: 'm1',
    ownerId: 'u1',
    schoolId: 's1',
    memberEmail: 'papa@yahoo.fr',
    memberName: 'M. Adjaho',
    role: 'parent',
    childStudentIds: ['stu1'],
  };
  const matchedByMembership = filterChildrenForParent({
    students,
    activeMembership: membership,
    parentEmail: 'papa@yahoo.fr',
    isPreview: false,
    activeOnly: true,
  });
  assert.equal(matchedByMembership.length, 1);
  assert.equal(matchedByMembership[0].id, 'stu1');
});

test('isAllowedCorsOrigin rejects prefix-spoofed origins and null origin', () => {
  assert.equal(isAllowedCorsOrigin('null'), false);
  assert.equal(isAllowedCorsOrigin('http://localhost.evil.com'), false);
  assert.equal(isAllowedCorsOrigin('https://127.0.0.1.evil.com'), false);
  assert.equal(
    isAllowedCorsOrigin('https://mon-lycee.tg.evil.com', {
      APP_URL: 'https://mon-lycee.tg',
    }),
    false
  );
  assert.equal(
    isAllowedCorsOrigin('https://mon-lycee.tg', {
      APP_URL: 'https://mon-lycee.tg/',
    }),
    true
  );
});

test('parseTogoClassProfile does not misclassify Serie C/D with accented French prepositions as Serie A', () => {
  const profileC = parseTogoClassProfile('1ère C', {
    id: 'c1',
    ownerId: 'u1',
    schoolId: 's1',
    name: '1ère C',
    level: '1ère',
    cycle: 'Lycée',
    series: 'Orientation à dominante scientifique',
    motif: 'maths-physique',
    accentColor: '#0284c7',
  });
  assert.equal(profileC.level, '1re');
  assert.equal(profileC.series, 'C');

  const profileA = parseTogoClassProfile('Tle A4');
  assert.equal(profileA.level, 'Tle');
  assert.equal(profileA.series, 'A');
});

test('computeMoyClasse and computeMoyMatiere follow Togo official weighted formula', () => {
  const moyCl = computeMoyClasse({ int1: 14, int2: 16, devoir: 13 });
  assert.equal(moyCl, 14);
  const moyMat = computeMoyMatiere({ int1: 14, int2: 16, devoir: 13, compo: 17 });
  assert.equal(moyMat, 16);
});

test('filterChildrenForParent attaches parent automatically via guardianPhone when parentEmail is empty', () => {
  const students: Student[] = [
    {
      id: 'stu_phone_1',
      ownerId: 'u1',
      schoolId: 's1',
      matricule: 'M10',
      nom: 'MENSAH',
      prenoms: 'Yao',
      sexe: 'M',
      age: 14,
      cycle: 'Collège',
      classe: '4ème A',
      guardianPhone: '+228 90 12 34 56',
      parentEmail: '',
      status: 'actif',
    },
  ];

  const matched = filterChildrenForParent({
    students,
    activeMembership: null,
    parentEmail: 'tel.22890123456@tel.schoolaria.app',
    isPreview: false,
    activeOnly: true,
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'stu_phone_1');

  const matchedRawPhone = filterChildrenForParent({
    students,
    activeMembership: null,
    parentEmail: '90 12 34 56',
    isPreview: false,
    activeOnly: true,
  });
  assert.equal(matchedRawPhone.length, 1);
  assert.equal(matchedRawPhone[0].id, 'stu_phone_1');
});

test('notification expiration and dismissal helpers filter expired and user-dismissed entries', () => {
  const baseNow = Date.UTC(2026, 10, 1, 10, 0, 0);
  assert.equal(computeNotificationExpiresAt('permanent', baseNow), null);

  const exp24h = computeNotificationExpiresAt('24h', baseNow)!;
  assert.equal(exp24h.getTime() - baseNow, 24 * 60 * 60 * 1000);

  assert.equal(isNotificationExpired({ expiresAt: null }, baseNow), false);
  assert.equal(isNotificationExpired({ expiresAt: exp24h }, baseNow + 1000), false);
  assert.equal(isNotificationExpired({ expiresAt: exp24h }, exp24h.getTime()), true);
  assert.equal(isNotificationExpired({ expiresAt: exp24h }, exp24h.getTime() + 1000), true);

  assert.equal(
    isNotificationVisibleForUser(
      { expiresAt: exp24h, dismissedByEmails: ['parent.a@exemple.com'] },
      'parent.b@exemple.com',
      baseNow + 1000
    ),
    true
  );
  assert.equal(
    isNotificationVisibleForUser(
      { expiresAt: exp24h, dismissedByEmails: ['parent.a@exemple.com'] },
      'parent.a@exemple.com',
      baseNow + 1000
    ),
    false
  );
  assert.equal(
    isNotificationVisibleForUser(
      { expiresAt: exp24h, dismissedByEmails: [] },
      'parent.b@exemple.com',
      exp24h.getTime() + 5000
    ),
    false
  );
});

test('parseTogoClassProfile and buildFixedSubjectsPreviewForClass apply fixed official coefficients for multiple classes', () => {
  assert.deepEqual(parseTogoClassProfile('6e A'), { cycle: 'Collège', level: '6e', series: null });
  assert.deepEqual(parseTogoClassProfile('5e'), { cycle: 'Collège', level: '5e', series: null });
  assert.deepEqual(parseTogoClassProfile('4e'), { cycle: 'Collège', level: '4e', series: null });
  assert.deepEqual(parseTogoClassProfile('3e'), { cycle: 'Collège', level: '3e', series: null });
  assert.deepEqual(parseTogoClassProfile('2nde A'), { cycle: 'Lycée', level: '2nde', series: 'A' });
  assert.deepEqual(parseTogoClassProfile('1re D2'), { cycle: 'Lycée', level: '1re', series: 'D' });
  assert.deepEqual(parseTogoClassProfile('Tle C1'), { cycle: 'Lycée', level: 'Tle', series: 'C' });

  const sixthSubjects = buildFixedSubjectsPreviewForClass('6e B', []);
  assert.ok(sixthSubjects.length >= 9);
  assert.equal(sixthSubjects.every((s) => s.coef === 1), true);

  const thirdSubjects = buildFixedSubjectsPreviewForClass('3e', []);
  const thirdMap = Object.fromEntries(thirdSubjects.map((s) => [s.name, s.coef]));
  assert.equal(thirdMap['Mathématiques'], 3);
  assert.equal(thirdMap['Français'], 3);

  const tleCSubjects = buildFixedSubjectsPreviewForClass('Tle C', []);
  const tleCMap = Object.fromEntries(tleCSubjects.map((s) => [s.name, s.coef]));
  assert.equal(tleCMap['Mathématiques'], 5);
  assert.equal(tleCMap['Physique-Chimie'], 4);

  const firstDSubjects = buildFixedSubjectsPreviewForClass('1re D', []);
  const firstDMap = Object.fromEntries(firstDSubjects.map((s) => [s.name, s.coef]));
  assert.equal(firstDMap['SVT'], 4);
  assert.equal(firstDMap['Mathématiques'], 3);

  const tleASubjects = buildFixedSubjectsPreviewForClass('Tle A4', []);
  const tleAMap = Object.fromEntries(tleASubjects.map((s) => [s.name, s.coef]));
  assert.equal(tleAMap['Philosophie'], 4);
  assert.equal(tleAMap['Français'], 3);
});

test('Vercel API catch-all handler disables bodyParser and awaits Express response completion', async () => {
  process.env.SCHOOLARIA_NO_LISTEN = '1';
  const mod = await import('../../api/[...route].ts');
  assert.equal(mod.config?.api?.bodyParser, false);

  const req = new EventEmitter() as unknown as Record<string, unknown>;
  req.method = 'GET';
  req.url = '/api/health';
  req.headers = { host: 'mon-ecole.vercel.app' };
  req.socket = {};

  const headers: Record<string, string> = {};
  let body = '';
  const res = new EventEmitter() as unknown as Record<string, unknown>;
  res.statusCode = 200;
  res.setHeader = (k: string, v: string) => {
    headers[k.toLowerCase()] = String(v);
  };
  res.getHeader = (k: string) => headers[k.toLowerCase()];
  res.writeHead = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.end = (chunk?: string | Buffer) => {
    if (chunk) body += chunk.toString();
    (res as unknown as EventEmitter).emit('finish');
    return res;
  };

  await mod.default(req as never, res as never);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(body) as { ok?: boolean; firebaseConfigured?: boolean };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.firebaseConfigured, true);
});
