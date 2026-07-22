import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { ToolsModule } from '../tools/tools.module';
import { UsageModule } from '../usage/usage.module';
import { AGENT_QUEUE, AgentProcessor } from './agent.processor';
import { ChatController } from './chat.controller';
import { SseController } from './sse.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: AGENT_QUEUE }),
    LlmModule,
    ToolsModule,
    UsageModule,
    MemoryModule,
  ],
  controllers: [ChatController, SseController],
  providers: [AgentProcessor],
})
export class AgentModule {}
