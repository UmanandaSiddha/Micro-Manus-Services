import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { MemoryService } from './memory.service';
import { SUMMARIZE_QUEUE, SummarizeProcessor } from './summarize.processor';

@Module({
  imports: [BullModule.registerQueue({ name: SUMMARIZE_QUEUE }), LlmModule],
  providers: [MemoryService, SummarizeProcessor],
  exports: [MemoryService, BullModule],
})
export class MemoryModule {}
