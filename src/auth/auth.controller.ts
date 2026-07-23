import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { Response } from 'express';
import { env } from '../config';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

const COOKIE = 'mm_session';
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Cross-origin cookie policy: 'lax' works while client and API share a site
 * (localhost:3000 → localhost:4000; app.x.com → api.x.com). Deploying client
 * and API on unrelated domains requires COOKIE_SAMESITE=none, which forces
 * Secure (HTTPS) — browsers reject SameSite=None without it.
 */
function cookieOptions() {
  const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as
    'lax' | 'none' | 'strict';
  return {
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' || env('APP_URL').startsWith('https'),
    path: '/',
  };
}

class SessionDto {
  @IsString()
  @MinLength(20)
  idToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Firebase popup happens client-side (signInWithPopup); the client exchanges
   * the resulting ID token here for our own httpOnly session cookie.
   */
  @Public()
  @Post('session')
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async session(
    @Body() dto: SessionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.loginWithIdToken(dto.idToken);
    res.cookie(COOKIE, this.auth.signSession(user.id), {
      ...cookieOptions(),
      maxAge: WEEK_MS,
    });
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE, cookieOptions());
    return { ok: true };
  }
}
