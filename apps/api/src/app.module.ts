import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { configuration, validationSchema } from '@/config/configuration';
import { AuthModule } from '@/auth/auth.module';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { DynamoModule } from '@/dynamo/dynamo.module';
import { LlmModule } from '@/llm/llm.module';
import { UsersModule } from '@/users/users.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { NodesModule } from '@/nodes/nodes.module';
import { AnnotationsModule } from '@/annotations/annotations.module';
import { HighlightsModule } from '@/highlights/highlights.module';
import { NotionModule } from '@/notion/notion.module';
import { ShareModule } from '@/share/share.module';
import { BillingModule } from '@/billing/billing.module';
import { AdminModule } from '@/admin/admin.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    AuthModule,
    DynamoModule,
    LlmModule,
    UsersModule,
    SessionsModule,
    NodesModule,
    AnnotationsModule,
    HighlightsModule,
    NotionModule,
    ShareModule,
    BillingModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply JWT guard globally; controllers opt out via @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
