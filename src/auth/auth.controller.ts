import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { Response } from 'express';
import { env } from '../config';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

const COOKIE = 'mm_session';
const WEEK_MS = 7 * 24 * 3600 * 1000;

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
  async session(@Body() dto: SessionDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.loginWithIdToken(dto.idToken);
    res.cookie(COOKIE, this.auth.signSession(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: env('APP_URL').startsWith('https'),
      maxAge: WEEK_MS,
      path: '/',
    });
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  }
}
