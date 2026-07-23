import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DecodedIdToken } from 'firebase-admin/auth';
import { DatabaseService } from '../db/database.service';
import { FirebaseService } from './firebase.service';

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

    // GitHub accounts can hide their email — fall back to a stable synthetic one.
    const email = decoded.email ?? `${decoded.uid}@users.noreply.firebase`;

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

  signSession(userId: string): string {
    return this.jwt.sign({ sub: userId });
  }
}
