import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { env } from '../config';
import { AuthService, OAuthProfile } from './auth.service';
import { Public } from './public.decorator';

const COOKIE = 'mm_session';
const WEEK_MS = 7 * 24 * 3600 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Get('google') @UseGuards(AuthGuard('google'))
  google() {} // passport redirects to Google

  @Public() @Get('github') @UseGuards(AuthGuard('github'))
  github() {} // passport redirects to GitHub

  @Public() @Get('google/callback') @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    await this.finishLogin(req, res);
  }

  @Public() @Get('github/callback') @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    await this.finishLogin(req, res);
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  }

  /**
   * Sets the session cookie, then closes the login flow. Login is opened as a
   * popup (firebase-style): notify the opener via postMessage and close.
   * Direct navigation (popup blocked) falls back to a redirect.
   */
  private async finishLogin(req: Request, res: Response) {
    const profile = req.user as OAuthProfile;
    const user = await this.auth.upsertUser(profile);
    const token = this.auth.signSession(user.id);
    const appUrl = env('APP_URL');

    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: appUrl.startsWith('https'),
      maxAge: WEEK_MS,
      path: '/',
    });

    res.type('html').send(`<!doctype html>
<title>Signed in</title>
<body style="font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:grid;place-items:center;height:100vh;margin:0">
<p>Signed in. You can close this window.</p>
<script>
  (function () {
    if (window.opener && !window.opener.closed) {
      try { window.opener.postMessage({ type: 'mm:auth', ok: true }, ${JSON.stringify(appUrl)}); } catch (e) {}
      window.close();
    } else {
      location.replace(${JSON.stringify(appUrl)} + '/chat');
    }
  })();
</script>
</body>`);
  }
}
