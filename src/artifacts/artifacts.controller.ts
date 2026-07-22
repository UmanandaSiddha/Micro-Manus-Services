import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { User } from '../auth/user.decorator';
import { ArtifactService } from './artifact.service';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  html: 'text/html',
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
};

@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactService) {}

  @Get(':id/download')
  async download(
    @User() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const a = await this.artifacts.getOwned(userId, id);
    const safeName = a.title.replace(/[^\w\d\- ]+/g, '').trim() || 'artifact';
    res.download(a.absPath, `${safeName}.${a.type}`, {
      headers: { 'Content-Type': MIME[a.type] ?? 'application/octet-stream' },
    });
  }
}
