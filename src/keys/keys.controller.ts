import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { User } from '../auth/user.decorator';
import { KeyProvider } from '../models/registry';
import { KeysService } from './keys.service';

class AddKeyDto {
  @IsString()
  @MinLength(8)
  apiKey!: string;

  @IsOptional()
  @IsIn(['openai', 'anthropic', 'moonshot', 'openrouter'])
  provider?: KeyProvider;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;
}

@Controller('keys')
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  add(@User() userId: string, @Body() dto: AddKeyDto) {
    return this.keys.addKey(userId, dto.apiKey.trim(), dto.provider, dto.baseUrl);
  }

  @Get()
  list(@User() userId: string) {
    return this.keys.listKeys(userId);
  }

  @Delete(':id')
  remove(@User() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.deleteKey(userId, id);
  }
}
