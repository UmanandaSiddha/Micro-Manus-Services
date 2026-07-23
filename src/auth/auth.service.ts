import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'crypto';
import { DecodedIdToken } from 'firebase-admin/auth';
import { env } from '../config';
import { DatabaseService } from '../db/database.service';
import { FirebaseService } from './firebase.service';

export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
/** Previous refresh token stays valid this long after rotation (concurrent tabs). */
const REFRESH_GRACE_MS = 30_000;

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  credits: number;
  role: 'user' | 'admin';
}

const PROVIDER_MAP: Record<string, 'google' | 'github'> = {
  'google.com': 'google',
  'github.com': 'github',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly firebase: FirebaseService,
  ) {}

  /** Verify a Firebase ID token and upsert our user row. */
  async loginWithIdToken(idToken: string): Promise<UserRow> {
    const decoded: DecodedIdToken = await this.firebase.verifyIdToken(idToken);
    const provider = PROVIDER_MAP[decoded.firebase?.sign_in_provider ?? ''];
    if (!provider)
      throw new UnauthorizedException('Unsupported sign-in provider');

    // GitHub can hide the email from the token claim — ask the Firebase user
    // record before giving up. The synthetic fallback keeps sign-in working
    // but creates an unlinked account, so it's the last resort.
    const email =
      decoded.email ??
      (await this.firebase.resolveEmail(decoded.uid)) ??
      `${decoded.uid}@users.noreply.firebase`;

    // The ADMIN_EMAIL env account is promoted on every sign-in; existing
    // admins are never demoted here (role changes otherwise stay manual).
    const isAdmin =
      email.toLowerCase() ===
      (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();

    // Keyed on email: the same person signing in via the other provider
    // re-links instead of violating unique(email).
    const row = await this.db.one<UserRow>(
      `INSERT INTO users (email, name, image, oauth_provider, oauth_id, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         image = COALESCE(EXCLUDED.image, users.image),
         oauth_provider = EXCLUDED.oauth_provider,
         oauth_id = EXCLUDED.oauth_id,
         role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE users.role END
       RETURNING id, email, name, image, credits, role`,
      [
        email,
        decoded.name ?? null,
        decoded.picture ?? null,
        provider,
        decoded.uid,
        isAdmin ? 'admin' : 'user',
      ],
    );
    return row!;
  }

  signAccess(userId: string): string {
    return this.jwt.sign({ sub: userId }, { expiresIn: '15m' });
  }

  /** HMAC keyed on the server secret — the raw refresh token never touches the DB. */
  private hashToken(token: string): string {
    return createHmac('sha256', env('JWT_SECRET')).update(token).digest('hex');
  }

  /** Create a session row; the returned cookie value is `${sessionId}.${token}`. */
  async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO sessions (user_id, refresh_hash, expires_at)
       VALUES ($1, $2, now() + interval '7 days') RETURNING id`,
      [userId, this.hashToken(token)],
    );
    return `${row!.id}.${token}`;
  }

  /**
   * Validate + rotate a refresh cookie. Returns the userId, plus a new cookie
   * value when the presented token was current (grace-window hits reuse the
   * newer cookie already in the browser's jar, so no Set-Cookie for them).
   */
  async rotateSession(
    cookieVal: string,
  ): Promise<{ userId: string; newCookie: string | null }> {
    const dot = cookieVal.indexOf('.');
    const sessionId = cookieVal.slice(0, dot);
    const token = cookieVal.slice(dot + 1);
    if (!/^[0-9a-f-]{36}$/.test(sessionId) || !token)
      throw new UnauthorizedException();

    const s = await this.db.one<{
      user_id: string;
      refresh_hash: string;
      prev_hash: string | null;
      rotated_at: Date | null;
      expires_at: Date;
    }>(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
    if (!s || s.expires_at.getTime() < Date.now()) {
      if (s)
        await this.db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
      throw new UnauthorizedException('Session expired');
    }

    const presented = this.hashToken(token);
    if (presented === s.refresh_hash) {
      // Normal path: rotate. Old token stays valid for the grace window.
      const next = randomBytes(32).toString('hex');
      await this.db.query(
        `UPDATE sessions SET prev_hash = refresh_hash, rotated_at = now(),
           refresh_hash = $2, expires_at = now() + interval '7 days'
         WHERE id = $1`,
        [sessionId, this.hashToken(next)],
      );
      return { userId: s.user_id, newCookie: `${sessionId}.${next}` };
    }
    const graceOk =
      s.prev_hash === presented &&
      s.rotated_at &&
      Date.now() - s.rotated_at.getTime() < REFRESH_GRACE_MS;
    if (graceOk) return { userId: s.user_id, newCookie: null };

    // Unknown token for a live session — possible theft; kill the session.
    await this.db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    throw new UnauthorizedException();
  }

  async revokeSession(cookieVal: string | undefined): Promise<void> {
    const sessionId = cookieVal?.split('.')[0];
    if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId))
      await this.db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }
}
