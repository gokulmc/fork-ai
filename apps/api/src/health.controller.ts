import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly cfg: ConfigService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check + build info (for live deploy status)' })
  check() {
    return {
      status: 'ok',
      version: this.cfg.get<string>('app.version') ?? '0.1.0',
      commit: this.cfg.get<string>('app.commit') ?? 'dev',
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
