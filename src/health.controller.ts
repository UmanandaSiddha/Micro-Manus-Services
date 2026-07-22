import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { DatabaseService } from './db/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
    return { ok: true, db: 'up', timestamp: new Date().toISOString() };
  }
}
