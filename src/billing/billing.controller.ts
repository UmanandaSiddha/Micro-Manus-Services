import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { User } from '../auth/user.decorator';
import { BillingService } from './billing.service';

class RedeemDto {
  @IsString()
  @Length(3, 64)
  code!: string;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  checkout(@User() userId: string) {
    return this.billing.createCheckout(userId);
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature) throw new BadRequestException('Missing signature');
    try {
      await this.billing.handleWebhook(req.rawBody, signature);
    } catch (e) {
      // Bad signature or malformed event — 400 so Stripe surfaces it
      throw new BadRequestException((e as Error).message);
    }
    return { received: true };
  }

  @Post('redeem')
  redeem(@User() userId: string, @Body() dto: RedeemDto) {
    return this.billing.redeem(userId, dto.code);
  }

  @Get('credits')
  credits(@User() userId: string) {
    return this.billing.credits(userId);
  }
}
