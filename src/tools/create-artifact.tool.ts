import { Injectable } from '@nestjs/common';
import { ArtifactService, ArtifactType } from '../artifacts/artifact.service';
import { AgentTool, ToolCtx, ToolOutput } from './tool.types';

@Injectable()
export class CreateArtifactTool implements AgentTool {
  constructor(private readonly artifacts: ArtifactService) {}

  readonly def = {
    name: 'create_artifact',
    description:
      'Create a downloadable file for the user. Use type "pdf" for research reports ' +
      '(content is markdown, rendered into a typeset document — include headings, inline ' +
      'citations [1] and a final "Sources" section). Other types: md, html, csv, json, txt.',
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
