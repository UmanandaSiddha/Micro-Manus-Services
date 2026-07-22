import { Module } from '@nestjs/common';
import { FetchUrlTool } from './fetch-url.tool';
import { ToolRegistry } from './tool.registry';
import { WebSearchTool } from './web-search.tool';

@Module({
  providers: [ToolRegistry, WebSearchTool, FetchUrlTool],
  exports: [ToolRegistry],
})
export class ToolsModule {}
