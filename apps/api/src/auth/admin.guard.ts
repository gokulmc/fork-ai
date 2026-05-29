import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

// Route-scoped guard (never registered as APP_GUARD). Runs after the global
// JwtAuthGuard has populated req.user, and checks the Cognito `admins` group
// claim carried inside the verified id_token.
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user as { 'cognito:groups'?: string[] } | undefined;
    const groups = user?.['cognito:groups'] ?? [];
    if (!groups.includes('admins')) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
