import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { env } from '../config';
import { ACCESS_TTL_MS, AuthService, SESSION_TTL_MS } from './auth.service';
import { Public } from './public.decorator';

const ACCESS_COOKIE = 'mm_access';
const REFRESH_COOKIE = 'mm_refresh';
// The refresh cookie only ever travels to auth endpoints.
const REFRESH_PATH = '/api/auth';

/**
 * Cross-origin cookie policy: 'lax' works while client and API share a site
 * (localhost:3000 → localhost:5000; app.x.com → api.x.com). Deploying client
 * and API on unrelated domains requires COOKIE_SAMESITE=none, which forces
 * Secure (HTTPS) — browsers reject SameSite=None without it.
 */
function cookieOptions(path = '/') {
  const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as
    'lax' | 'none' | 'strict';
  return {
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' || env('APP_URL').startsWith('https'),
    path,
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

  private setAuthCookies(res: Response, userId: string, refreshCookie: string) {
    res.cookie(ACCESS_COOKIE, this.auth.signAccess(userId), {
      ...cookieOptions(),
      maxAge: ACCESS_TTL_MS,
    });
    res.cookie(REFRESH_COOKIE, refreshCookie, {
      ...cookieOptions(REFRESH_PATH),
      maxAge: SESSION_TTL_MS,
    });
  }

  /**
   * Firebase popup happens client-side (signInWithPopup) and is identity
   * verification only — user records, sessions, tokens and cookies are ours.
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
    this.setAuthCookies(res, user.id, await this.auth.createSession(user.id));
    return { user };
  }

  /** Rotate the refresh token → fresh access cookie. Client calls this on 401. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieVal = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    res.setHeader('Cache-Control', 'no-store');
    if (!cookieVal) throw new UnauthorizedException();
    const { userId, newCookie } = await this.auth.rotateSession(cookieVal);
    res.cookie(ACCESS_COOKIE, this.auth.signAccess(userId), {
      ...cookieOptions(),
      maxAge: ACCESS_TTL_MS,
    });
    if (newCookie)
      res.cookie(REFRESH_COOKIE, newCookie, {
        ...cookieOptions(REFRESH_PATH),
        maxAge: SESSION_TTL_MS,
      });
    return { ok: true };
  }

  /** Public so an expired access token can still clear its cookies. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(
      (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE],
    );
    res.clearCookie(ACCESS_COOKIE, cookieOptions());
    res.clearCookie(REFRESH_COOKIE, cookieOptions(REFRESH_PATH));
    return { ok: true };
  }
}
