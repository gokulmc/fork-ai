import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { configuration, validationSchema } from '@/config/configuration';
import { AuthModule } from '@/auth/auth.module';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { UsersModule } from '@/users/users.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { NodesModule } from '@/nodes/nodes.module';
import { ProjectsModule } from '@/projects/projects.module';
import { GithubModule } from '@/github/github.module';
import { AnnotationsModule } from '@/annotations/annotations.module';
import { HighlightsModule } from '@/highlights/highlights.module';
import { BillingModule } from '@/billing/billing.module';
import { AttachmentsModule } from '@/attachments/attachments.module';
import { DevicesModule } from '@/devices/devices.module';
import { AccountModule } from '@/account/account.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    // Per-IP rate limit (in-memory, per instance).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
    DynamoModule,
    LlmModule,
    UsersModule,
    SessionsModule,
    NodesModule,
    ProjectsModule,
    GithubModule,
    AnnotationsModule,
    HighlightsModule,
    BillingModule,
    AttachmentsModule,
    DevicesModule,
    AccountModule,
  ],
  controllers: [HealthController],
  providers: [
    // Throttler first so rate limits apply before auth (covers @Public routes too)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Apply JWT guard globally; controllers opt out via @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
