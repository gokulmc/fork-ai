import { Controller, Get, Query } from '@nestjs/common';
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

  // TEMPORARY — verifies the LB idle + nginx proxy_read timeouts allow a >60s
  // request. Remove once the long-running web-search timeout fix is confirmed.
  @Public()
  @Get('health/slow')
  @ApiOperation({ summary: 'TEMP: sleep then 200 — timeout-wall verification' })
  async slow(@Query('ms') ms?: string) {
    const delay = Math.min(Math.max(Number(ms) || 0, 0), 280_000);
    await new Promise(resolve => setTimeout(resolve, delay));
    return { status: 'ok', sleptMs: delay, uptimeSec: Math.round(process.uptime()) };
  }
}
