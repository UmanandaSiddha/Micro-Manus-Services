import { Injectable } from '@nestjs/common';
import { ArtifactService, ArtifactType } from '../artifacts/artifact.service';
import { AgentTool, ToolCtx, ToolOutput } from './tool.types';

@Injectable()
export class CreateArtifactTool implements AgentTool {
  constructor(private readonly artifacts: ArtifactService) {}

  readonly def = {
    name: 'create_artifact',
    description:
      'Create a downloadable file for the user.\n' +
      'type "pdf" — markdown rendered into a typeset A4 report. Structure it like a ' +
      'professional research report: open with a 2–4 sentence executive summary paragraph ' +
      '(no heading), then "## " sections; use markdown tables for any comparison or numeric ' +
      'data; bold key figures; cite inline with [1]; end with "## Sources" as a numbered ' +
      'list of "Title — URL". Do NOT start with a title heading — the cover page already ' +
      'shows the title.\n' +
      'type "html" — a COMPLETE standalone webpage, production quality. Requirements: ' +
      'semantic HTML5; ALL styling in one <style> block (no external fonts/CSS/JS/images); ' +
      'a cohesive palette (pick 1 accent + neutrals, consistent), generous whitespace and a ' +
      'clear type hierarchy; a distinct hero section; content sections with cards/grids ' +
      'where fitting; responsive (max-width container + one mobile media query); subtle ' +
      'polish (border-radius, hover states, box-shadows). Never emit a bare or minimally ' +
      'styled page.\n' +
      'Other types: md, csv (header row + clean rows), json (valid, pretty), txt.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['pdf', 'md', 'html', 'csv', 'json', 'txt'],
        },
        title: { type: 'string', description: 'Human-readable document title' },
        content: {
          type: 'string',
          description: 'The full file content (markdown for pdf/md)',
        },
      },
      required: ['type', 'title', 'content'],
    },
  };

  async execute(
    args: Record<string, unknown>,
    ctx: ToolCtx,
  ): Promise<ToolOutput> {
    const type = String(args.type ?? 'md') as ArtifactType;
    const title = String(args.title ?? 'Untitled');
    const content = String(args.content ?? '');
    const created = await this.artifacts.create({
      threadId: ctx.threadId,
      runId: ctx.runId,
      type,
      title,
      contentMd: content,
    });
    return {
      content: `Artifact created (id: ${created.id}). The user can preview and download "${title}" (${type}) in this chat. Mention that the file is ready — do not repeat its full content in your reply.`,
      summary: `${title}`,
      artifactId: created.id,
      artifactType: type,
      artifactTitle: title,
    };
  }
}
