import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { env } from '../config';
import { DatabaseService } from '../db/database.service';

export const CREDITS_PER_PURCHASE = 5;
export const PRICE_CENTS = 500;
/** Coupon = backend bypass switch, not a Stripe discount. */
const COUPONS: Record<string, number> = { SID_DRDROID: 5 };

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private stripeClient: Stripe | null = null;

  constructor(private readonly db: DatabaseService) {}

  get stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new ServiceUnavailableException('Stripe is not configured');
    return (this.stripeClient ??= new Stripe(key));
  }

  async createCheckout(userId: string): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PRICE_CENTS,
            product_data: {
              name: `MicroManus — ${CREDITS_PER_PURCHASE} research credits`,
            },
          },
        },
      ],
      metadata: { userId },
      success_url: `${env('APP_URL')}/paywall?paid=1`,
      cancel_url: `${env('APP_URL')}/paywall`,
    });
    return { url: session.url! };
  }

  /** Idempotent: stripe_events gate makes webhook retries a no-op. */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whSecret) throw new ServiceUnavailableException('Webhook secret not configured');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, whSecret);

    if (event.type !== 'checkout.session.completed') return;
    const session = event.data.object;
    const userId = session.metadata?.userId;
    if (!userId) {
      this.log.warn(`checkout.session.completed without userId (${session.id})`);
      return;
    }

    await this.db.tx(async (q) => {
      const seen = await q.one(
        `INSERT INTO stripe_events (event_id) VALUES ($1)
         ON CONFLICT DO NOTHING RETURNING event_id`,
        [event.id],
      );
      if (!seen) return; // retry — already granted
      await q.query(`UPDATE users SET credits = credits + $2 WHERE id = $1`, [
        userId,
        CREDITS_PER_PURCHASE,
      ]);
      await q.query(
        `INSERT INTO credit_ledger (user_id, delta, reason, ref_id)
         VALUES ($1, $2, 'purchase', $3)`,
        [userId, CREDITS_PER_PURCHASE, session.id],
      );
    });
    this.log.log(`Granted ${CREDITS_PER_PURCHASE} credits to ${userId} (purchase)`);
  }

  async redeem(userId: string, code: string): Promise<{ credits: number }> {
    const grant = COUPONS[code.trim().toUpperCase()];
    if (!grant) throw new BadRequestException('Invalid coupon code'); // 400 per api.md; 409 = already redeemed

    return this.db.tx(async (q) => {
      const inserted = await q.one(
        `INSERT INTO redemptions (user_id, code) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING code`,
        [userId, code.trim().toUpperCase()],
      );
      if (!inserted) throw new ConflictException('Coupon already redeemed');
      const row = await q.one<{ credits: number }>(
        `UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING credits`,
        [userId, grant],
      );
      await q.query(
        `INSERT INTO credit_ledger (user_id, delta, reason, ref_id)
         VALUES ($1, $2, 'coupon', $3)`,
        [userId, grant, code.trim().toUpperCase()],
      );
      return { credits: row!.credits };
    });
  }

  async credits(userId: string) {
    const [user, ledger] = await Promise.all([
      this.db.one<{ credits: number }>(`SELECT credits FROM users WHERE id = $1`, [userId]),
      this.db.query(
        `SELECT delta, reason, ref_id, created_at FROM credit_ledger
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
    ]);
    return { credits: user?.credits ?? 0, ledger };
  }
}
