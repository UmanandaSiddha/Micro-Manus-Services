import { Module } from '@nestjs/common';
import { ArtifactService } from './artifact.service';
import { ArtifactsController } from './artifacts.controller';

@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class ArtifactsModule {}
