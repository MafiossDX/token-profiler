import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { LocalSecret } from './types.ts';

// local_secret + Fingerprint Key Epoch (CONTEXT.md). Lives outside the
// per-Task SQLite DB so that rotating it (privacy reset) doesn't require
// touching Task data, and so every Task on this machine shares one epoch
// until explicitly rotated.
const HOME_DIR = path.join(os.homedir(), '.token-profiler');
const SECRET_PATH = path.join(HOME_DIR, 'secret.json');

export function loadOrCreateSecret(): LocalSecret {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  if (fs.existsSync(SECRET_PATH)) {
    const data = JSON.parse(fs.readFileSync(SECRET_PATH, 'utf8')) as LocalSecret;
    return data;
  }
  const secret: LocalSecret = {
    epoch_id: crypto.randomUUID(),
    secret_hex: crypto.randomBytes(32).toString('hex'),
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(SECRET_PATH, JSON.stringify(secret, null, 2));
  return secret;
}

export function homeDir(): string {
  return HOME_DIR;
}
