import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../db/database.service';

export interface OAuthProfile {
  provider: 'google' | 'github';
  oauthId: string;
  email: string;
  name: string | null;
  image: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  credits: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Upsert keyed on email: same person signing in via the other provider
   * re-links to that provider instead of failing the unique(email) constraint.
   */
  async upsertUser(p: OAuthProfile): Promise<UserRow> {
    const row = await this.db.one<UserRow>(
      `INSERT INTO users (email, name, image, oauth_provider, oauth_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         image = COALESCE(EXCLUDED.image, users.image),
         oauth_provider = EXCLUDED.oauth_provider,
         oauth_id = EXCLUDED.oauth_id
       RETURNING id, email, name, image, credits`,
      [p.email, p.name, p.image, p.provider, p.oauthId],
    );
    return row!;
  }

  signSession(userId: string): string {
    return this.jwt.sign({ sub: userId });
  }
}
