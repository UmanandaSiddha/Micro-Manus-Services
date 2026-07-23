import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { User } from '../auth/user.decorator';
import { ArtifactService } from './artifact.service';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactService) {}

  /** Metadata + source content — powers the text-based previews (md/csv/json/txt/html). */
  @Get(':id')
  async meta(@User() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.artifacts.getOwned(userId, id);
    return {
      id: a.id,
      type: a.type,
      title: a.title,
      content: a.content_md,
    };
  }

  /** Inline serve — the PDF/HTML preview iframe fetches this as a blob. */
  @Get(':id/file')
  async file(
    @User() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const a = await this.artifacts.getOwned(userId, id);
    res.sendFile(a.absPath, {
      headers: {
        'Content-Type': MIME[a.type] ?? 'application/octet-stream',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        // Agent-generated HTML opens in a tab on the API origin — sandbox it
        // to an opaque origin so its scripts can't reuse the session cookie.
        ...(a.type === 'html'
          ? { 'Content-Security-Policy': 'sandbox allow-scripts allow-popups' }
          : {}),
      },
    });
  }

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
