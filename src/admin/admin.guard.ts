import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SessionUser } from '../auth/jwt.guard';
import { DatabaseService } from '../db/database.service';

/** Runs after the global JWT guard — checks the caller's role in the DB. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
    const row = await this.db.one<{ role: string }>(
      `SELECT role FROM users WHERE id = $1`,
      [req.user?.userId],
    );
    if (row?.role !== 'admin') throw new ForbiddenException('Admins only');
    return true;
  }
}
