import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { env } from '../config';
import { OAuthProfile } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      callbackURL: `${env('APP_URL')}/api/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  validate(_at: string, _rt: string, profile: Profile): OAuthProfile {
    return {
      provider: 'google',
      oauthId: profile.id,
      email: profile.emails?.[0]?.value ?? `${profile.id}@google.local`,
      name: profile.displayName || null,
      image: profile.photos?.[0]?.value ?? null,
    };
  }
}
