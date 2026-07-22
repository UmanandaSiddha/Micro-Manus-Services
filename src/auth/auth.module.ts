import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { env } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubStrategy } from './github.strategy';
import { GoogleStrategy } from './google.strategy';
import { JwtGuard } from './jwt.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: env('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleStrategy,
    GithubStrategy,
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
})
export class AuthModule {}
