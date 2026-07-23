import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { cert, getApps, initializeApp, App } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';

/**
 * firebase-admin wrapper (pattern from ovlox_v3_backend): service account from
 * three env vars, private key \n-normalized. Missing config → app still boots,
 * verification fails closed with 401.
 */
@Injectable()
export class FirebaseService {
  private readonly log = new Logger(FirebaseService.name);
  private app: App | null = null;

  onModuleInit(): void {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      this.log.warn(
        'Firebase env vars missing — sign-in will fail until configured',
      );
      return;
    }
    try {
      this.app =
        getApps()[0] ??
        initializeApp({
          credential: cert({ projectId, clientEmail, privateKey }),
        });
    } catch (e) {
      // Malformed key must not take the whole app down — only sign-in.
      this.log.warn(
        `Firebase init failed — sign-in disabled: ${(e as Error).message}`,
      );
    }
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    if (!this.app) throw new UnauthorizedException('Auth is not configured');
    try {
      return await getAuth(this.app).verifyIdToken(idToken, true); // checkRevoked
    } catch (e) {
      this.log.warn(`ID token rejected: ${(e as Error).message}`);
      throw new UnauthorizedException('Invalid sign-in token');
    }
  }
}
