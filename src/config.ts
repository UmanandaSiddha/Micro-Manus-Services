// Env access with fail-fast assertion. Feature milestones append to REQUIRED.
const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'APP_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

export function assertEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY!)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
}

export function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${key}`);
  return v;
}
