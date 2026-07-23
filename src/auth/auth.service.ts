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

    const name = decoded.name ?? null;
    const image = decoded.picture ?? null;
    const role = isAdmin ? 'admin' : 'user';

    // Auto-heal + upsert in one transaction. Two lookups because a returning
    // user can be found by their oauth identity OR by email, and those can
    // point at *different* rows — the case that produced a duplicate before:
    //   - byIdentity: same (provider, oauth_id) — the row we minted last time,
    //     possibly under a synthetic @users.noreply.firebase email.
    //   - byEmail: whoever currently owns this (now real) email.
    return this.db.tx(async (q) => {
      const byIdentity = await q.one<{ id: string }>(
        `SELECT id FROM users WHERE oauth_provider = $1 AND oauth_id = $2`,
        [provider, decoded.uid],
      );
      const byEmail = await q.one<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );

      // Heal: the identity's old (synthetic) account and the real-email account
      // are different rows → fold the old one into the real one, then the real
      // one survives and gets re-linked to this identity below.
      if (byIdentity && byEmail && byIdentity.id !== byEmail.id) {
        await this.mergeUsers(q, byIdentity.id, byEmail.id);
      }

      // Survivor: prefer the real-email row; else the identity row (in-place
      // heal of a still-synthetic account whose email just became real).
      const targetId = byEmail?.id ?? byIdentity?.id ?? null;

      if (targetId) {
        const row = await q.one<UserRow>(
          `UPDATE users SET
             email = $2,
             name = COALESCE($3, name),
             image = COALESCE($4, image),
             oauth_provider = $5,
             oauth_id = $6,
             role = CASE WHEN $7 = 'admin' THEN 'admin' ELSE role END
           WHERE id = $1
           RETURNING id, email, name, image, credits, role`,
          [targetId, email, name, image, provider, decoded.uid, role],
        );
        return row!;
      }

      const row = await q.one<UserRow>(
        `INSERT INTO users (email, name, image, oauth_provider, oauth_id, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, name, image, credits, role`,
        [email, name, image, provider, decoded.uid, role],
      );
      return row!;
    });
  }

  /**
   * Fold the `loser` account into `winner`: reassign owned rows, sum credits,
   * then delete the loser (cascades sessions + any rows left behind by the
   * conflict-safe moves). Used only during auto-heal of a duplicate account.
   */
  private async mergeUsers(
    q: { query: (sql: string, params: unknown[]) => Promise<unknown> },
    loser: string,
    winner: string,
  ): Promise<void> {
    // Freely-reassignable owned rows (no per-user uniqueness).
    for (const t of [
      'threads',
      'runs',
      'usage_events',
      'uploads',
      'credit_ledger',
    ]) {
      await q.query(`UPDATE ${t} SET user_id = $1 WHERE user_id = $2`, [
        winner,
        loser,
      ]);
    }
    // UNIQUE(user_id, provider): move only keys the winner lacks; the rest die
    // with the loser (winner's own key for that provider wins).
    await q.query(
      `UPDATE api_keys k SET user_id = $1 WHERE k.user_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM api_keys w WHERE w.user_id = $1 AND w.provider = k.provider)`,
      [winner, loser],
    );
    // PK(user_id, code): move only codes the winner hasn't already redeemed.
    await q.query(
      `UPDATE redemptions r SET user_id = $1 WHERE r.user_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM redemptions w WHERE w.user_id = $1 AND w.code = r.code)`,
      [winner, loser],
    );
    // Carry the loser's credit balance over before deleting it.
    await q.query(
      `UPDATE users SET credits = credits + (SELECT credits FROM users WHERE id = $2)
       WHERE id = $1`,
      [winner, loser],
    );
    await q.query(`DELETE FROM users WHERE id = $1`, [loser]);
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
