import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CognitoUser } from './jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CognitoUser => {
    const request = ctx.switchToHttp().getRequest<{ user: CognitoUser }>();
    return request.user;
  },
);
