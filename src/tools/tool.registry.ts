import { Injectable } from '@nestjs/common';
import { ToolDef } from '../llm/types';
import { CreateArtifactTool } from './create-artifact.tool';
import { FetchUrlTool } from './fetch-url.tool';
import { ReadArtifactTool } from './read-artifact.tool';
import { AgentTool, ToolCtx, ToolOutput } from './tool.types';
import { WebSearchTool } from './web-search.tool';

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(
    webSearch: WebSearchTool,
    fetchUrl: FetchUrlTool,
    createArtifact: CreateArtifactTool,
    readArtifact: ReadArtifactTool,
  ) {
    for (const t of [webSearch, fetchUrl, createArtifact, readArtifact] as AgentTool[])
      this.register(t);
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.def.name, tool);
  }

  defs(): ToolDef[] {
    // Deterministic order — tool order is part of the prompt-cache prefix
    return [...this.tools.values()].map((t) => t.def).sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(name: string, argsJson: string, ctx: ToolCtx): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) return { content: `Unknown tool: ${name}`, summary: `unknown tool ${name}` };
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    } catch {
      return { content: 'Invalid tool arguments (bad JSON).', summary: 'bad tool args' };
    }
    try {
      return await tool.execute(args, ctx);
    } catch (e) {
      const msg = (e as Error).message ?? 'tool failed';
      return { content: `Tool error: ${msg}`, summary: `error: ${msg.slice(0, 80)}` };
    }
  }
}
