import { Injectable } from '@nestjs/common';
import { ArtifactService } from '../artifacts/artifact.service';
import { AgentTool, ToolCtx, ToolOutput } from './tool.types';

@Injectable()
export class ReadArtifactTool implements AgentTool {
  constructor(private readonly artifacts: ArtifactService) {}

  readonly def = {
    name: 'read_artifact',
    description:
      'Read back the source content of a file previously created in this conversation ' +
      '(use when the user asks about a generated report/document).',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'The artifact id' },
      },
      required: ['artifactId'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolOutput> {
    const a = await this.artifacts.getOwned(ctx.userId, String(args.artifactId ?? ''));
    return {
      content: a.content_md ?? '(no stored content)',
      summary: `Read “${a.title}”`,
    };
  }
}
