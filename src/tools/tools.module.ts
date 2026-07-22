import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { CreateArtifactTool } from './create-artifact.tool';
import { FetchUrlTool } from './fetch-url.tool';
import { ReadArtifactTool } from './read-artifact.tool';
import { ToolRegistry } from './tool.registry';
import { WebSearchTool } from './web-search.tool';

@Module({
  imports: [ArtifactsModule],
  providers: [ToolRegistry, WebSearchTool, FetchUrlTool, CreateArtifactTool, ReadArtifactTool],
  exports: [ToolRegistry],
})
export class ToolsModule {}
