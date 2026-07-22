import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import { env } from '../config';

// AES-256-GCM. Format: base64(iv).base64(tag).base64(ciphertext)
const ALGO = 'aes-256-gcm';

function key(): Buffer {
  return Buffer.from(env('ENCRYPTION_KEY'), 'hex');
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** "sk-…4f2a" — the only representation that ever leaves the server. */
export function hint(plain: string): string {
  const head = plain.slice(0, 3);
  const tail = plain.slice(-4);
  return `${head}…${tail}`;
}
