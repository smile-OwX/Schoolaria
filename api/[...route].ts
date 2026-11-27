import type { Request, Response } from 'express';
import app from '../server.ts';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: Request, res: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    res.once('finish', done);
    res.once('close', done);
    app(req, res, (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    });
  });
}
