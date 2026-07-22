import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionUser } from './jwt.guard';

/** @User() userId: string — the authenticated user's id from the JWT cookie. */
export const User = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user: SessionUser }>();
  return req.user.userId;
});
