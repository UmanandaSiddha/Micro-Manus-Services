import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';

@Controller('me')
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async me(@User() userId: string) {
    const user = await this.db.one<{
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      credits: number;
      role: 'user' | 'admin';
    }>(
      'SELECT id, email, name, image, credits, role FROM users WHERE id = $1',
      [userId],
    );

    // Valid cookie for a deleted account — treat as signed out.
    if (!user) throw new UnauthorizedException();

    const [entitled, key] = await Promise.all([
      this.db.one(
        `SELECT 1 FROM credit_ledger WHERE user_id = $1 AND reason IN ('purchase','coupon') LIMIT 1`,
        [userId],
      ),
      this.db.one('SELECT 1 FROM api_keys WHERE user_id = $1 LIMIT 1', [
        userId,
      ]),
    ]);

    return {
      user,
      credits: user?.credits ?? 0,
      hasEntitlement: !!entitled,
      hasKey: !!key,
    };
  }
}
