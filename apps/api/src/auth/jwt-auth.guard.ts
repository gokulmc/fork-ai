import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    // Auth disabled for local testing — re-enable before prod
    const req = ctx.switchToHttp().getRequest<{ user: unknown }>();
    req.user = { sub: 'dev-user', email: 'dev@localhost' };
    return true;
  }
}
