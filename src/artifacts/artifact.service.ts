import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '../config';
import { DatabaseService } from '../db/database.service';
import { closeBrowser, renderPdf } from './pdf';

export type ArtifactType = 'pdf' | 'md' | 'html' | 'csv' | 'json' | 'txt';
const EXT: Record<ArtifactType, string> = {
  pdf: 'pdf',
  md: 'md',
  html: 'html',
  csv: 'csv',
  json: 'json',
  txt: 'txt',
};

@Injectable()
export class ArtifactService implements OnModuleDestroy {
  constructor(private readonly db: DatabaseService) {}

  private dir(): string {
    return resolve(env('ARTIFACTS_DIR', './data/artifacts'));
  }

  async create(params: {
    threadId: string;
    runId: string;
    type: ArtifactType;
    title: string;
    contentMd: string;
  }): Promise<{ id: string }> {
    const { type, title, contentMd } = params;
    if (!EXT[type])
      throw new BadRequestException(`Unsupported artifact type: ${type}`);

    let bytes: Buffer;
    if (type === 'pdf') {
      bytes = await renderPdf(title, contentMd);
    } else if (type === 'json') {
      JSON.parse(contentMd); // validate
      bytes = Buffer.from(contentMd, 'utf8');
    } else {
      bytes = Buffer.from(contentMd, 'utf8');
    }

    const row = await this.db.one<{ id: string }>(
      `INSERT INTO artifacts (thread_id, run_id, type, title, file_path, content_md, size_bytes)
       VALUES ($1,$2,$3,$4,'',$5,$6) RETURNING id`,
      [
        params.threadId,
        params.runId,
        type,
        title.slice(0, 200),
        contentMd,
        bytes.length,
      ],
    );
    const id = row!.id;

    const relPath = join(params.threadId, `${id}.${EXT[type]}`);
    await mkdir(join(this.dir(), params.threadId), { recursive: true });
    await writeFile(join(this.dir(), relPath), bytes);
    await this.db.query(`UPDATE artifacts SET file_path = $2 WHERE id = $1`, [
      id,
      relPath,
    ]);

    return { id };
  }

  async getOwned(userId: string, artifactId: string) {
    const row = await this.db.one<{
      id: string;
      type: ArtifactType;
      title: string;
      file_path: string;
      content_md: string | null;
    }>(
      `SELECT a.id, a.type, a.title, a.file_path, a.content_md
       FROM artifacts a JOIN threads t ON t.id = a.thread_id
       WHERE a.id = $1 AND t.user_id = $2`,
      [artifactId, userId],
    );
    if (!row) throw new NotFoundException('Artifact not found');
    return { ...row, absPath: join(this.dir(), row.file_path) };
  }

  async onModuleDestroy() {
    await closeBrowser();
  }
}
