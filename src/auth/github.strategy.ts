import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';
import { env } from '../config';
import { OAuthProfile } from './auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor() {
    super({
      clientID: env('GITHUB_CLIENT_ID'),
      clientSecret: env('GITHUB_CLIENT_SECRET'),
      callbackURL: `${env('APP_URL')}/api/auth/github/callback`,
      scope: ['user:email'],
    });
  }

  validate(_at: string, _rt: string, profile: Profile): OAuthProfile {
    const username = (profile.username as string) || profile.id;
    return {
      provider: 'github',
      oauthId: profile.id,
      email: profile.emails?.[0]?.value ?? `${username}@users.noreply.github.com`,
      name: profile.displayName || username || null,
      image: profile.photos?.[0]?.value ?? null,
    };
  }
}
