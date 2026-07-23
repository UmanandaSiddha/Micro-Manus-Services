import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { DatabaseService } from '../db/database.service';

const PER_FILE_TEXT_CAP = 8_000;
const TOTAL_CONTEXT_CAP = 24_000;

export interface UploadRow {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  url: string;
}

@Injectable()
export class UploadsService {
  private readonly log = new Logger(UploadsService.name);

  constructor(private readonly db: DatabaseService) {}

  private dir(): string {
    // public/ is served statically at /public (see main.ts).
    return join(process.cwd(), 'public', 'uploads');
  }

  async save(
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<UploadRow> {
    const id = randomUUID();
    const ext = (extname(file.originalname) || '').slice(0, 12);
    const stored = `${id}${ext}`;
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), stored), file.buffer);

    const text = await this.extractText(file.mimetype, file.originalname, file.buffer);
    const url = `/public/uploads/${stored}`;

    await this.db.query(
      `INSERT INTO uploads (id, user_id, filename, mime, size_bytes, url, text_content)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, userId, file.originalname.slice(0, 200), file.mimetype, file.size, url, text],
    );
    return { id, filename: file.originalname, mime: file.mimetype, size_bytes: file.size, url };
  }

  /** Link uploads to a thread (called when a message with attachments is sent). */
  async attachToThread(userId: string, threadId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db.query(
      `UPDATE uploads SET thread_id = $1 WHERE user_id = $2 AND id = ANY($3::uuid[])`,
      [threadId, userId, ids],
    );
  }

  async listForThread(threadId: string): Promise<UploadRow[]> {
    return this.db.query<UploadRow>(
      `SELECT id, filename, mime, size_bytes, url FROM uploads
       WHERE thread_id = $1 ORDER BY created_at`,
      [threadId],
    );
  }

  /** Compact context block of a thread's attached-file texts, for the agent. */
  async contextBlock(threadId: string): Promise<string | null> {
    const rows = await this.db.query<{ filename: string; text_content: string | null }>(
      `SELECT filename, text_content FROM uploads
       WHERE thread_id = $1 AND text_content IS NOT NULL AND text_content <> ''
       ORDER BY created_at`,
      [threadId],
    );
    if (!rows.length) return null;
    let out = '<attached_files>\nThe user attached these files — use them as primary context:\n';
    for (const r of rows) {
      const slice = r.text_content!.slice(0, PER_FILE_TEXT_CAP);
      if (out.length + slice.length > TOTAL_CONTEXT_CAP) break;
      out += `\n--- ${r.filename} ---\n${slice}\n`;
    }
    return out + '</attached_files>';
  }

  private async extractText(mime: string, name: string, buf: Buffer): Promise<string | null> {
    const textLike =
      mime.startsWith('text/') ||
      /json|csv|xml|markdown|javascript|typescript/.test(mime) ||
      /\.(txt|md|csv|json|log|xml|html?|ya?ml)$/i.test(name);
    try {
      if (textLike) return buf.toString('utf8').slice(0, PER_FILE_TEXT_CAP * 3);
      if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
        const { PDFParse } = (await import('pdf-parse')) as {
          PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> };
        };
        const parser = new PDFParse({ data: buf });
        const { text } = await parser.getText();
        return text.slice(0, PER_FILE_TEXT_CAP * 3);
      }
    } catch (e) {
      this.log.warn(`text extraction failed for ${name}: ${(e as Error).message}`);
    }
    return null; // images, binaries → stored + linked, no text context
  }
}
