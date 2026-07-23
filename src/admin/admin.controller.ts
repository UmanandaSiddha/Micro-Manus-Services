import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { User } from '../auth/user.decorator';
import { DatabaseService } from '../db/database.service';
import { AdminGuard } from './admin.guard';

class GrantCreditsDto {
  @IsInt()
  @Min(-100)
  @Max(100)
  delta!: number;
}

/** Platform-admin endpoints — role check in AdminGuard (after the global JWT guard). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('stats')
  async stats() {
    const row = await this.db.one<Record<string, unknown>>(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                                          AS users,
        (SELECT COUNT(*)::int FROM runs)                                           AS runs,
        (SELECT COUNT(*)::int FROM runs WHERE status = 'failed')                   AS failed_runs,
        (SELECT COUNT(*)::int FROM artifacts)                                      AS artifacts,
        (SELECT COALESCE(SUM(cost_usd), 0)::float FROM usage_events)               AS llm_cost_usd,
        (SELECT COUNT(*)::int FROM credit_ledger WHERE reason = 'purchase')        AS purchases,
        (SELECT COUNT(*)::int FROM credit_ledger WHERE reason = 'coupon')          AS coupon_redemptions,
        (SELECT COALESCE(SUM(delta), 0)::int FROM credit_ledger WHERE delta > 0)   AS credits_granted,
        (SELECT COALESCE(-SUM(delta), 0)::int FROM credit_ledger WHERE delta < 0)  AS credits_spent
    `);
    return row;
  }

  @Get('users')
  async users(@Query('search') search?: string) {
    const like = search?.trim() ? `%${search.trim()}%` : null;
    return this.db.query(
      `SELECT u.id, u.email, u.name, u.image, u.role, u.credits, u.created_at,
              (SELECT COUNT(*)::int FROM threads t WHERE t.user_id = u.id)        AS threads,
              (SELECT COUNT(*)::int FROM runs r WHERE r.user_id = u.id)           AS runs,
              (SELECT COALESCE(SUM(e.cost_usd), 0)::float FROM usage_events e
                WHERE e.user_id = u.id)                                           AS cost_usd,
              (SELECT COUNT(*)::int FROM api_keys k WHERE k.user_id = u.id) > 0   AS has_key
       FROM users u
       WHERE ($1::text IS NULL OR u.email ILIKE $1 OR u.name ILIKE $1)
       ORDER BY u.created_at DESC
       LIMIT 100`,
      [like],
    );
  }

  /** Manual credit adjustment (demo headroom, support). Ledgered as admin_grant. */
  @Post('users/:id/credits')
  async grantCredits(
    @User() adminId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body() dto: GrantCreditsDto,
  ) {
    return this.db.tx(async (q) => {
      const row = await q.one<{ credits: number }>(
        // credits >= 0 check constraint rejects an over-deduction atomically.
        `UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING credits`,
        [targetId, dto.delta],
      );
      await q.query(
        `INSERT INTO credit_ledger (user_id, delta, reason, ref_id)
         VALUES ($1, $2, 'admin_grant', $3)`,
        [targetId, dto.delta, adminId],
      );
      return { credits: row!.credits };
    });
  }
}
