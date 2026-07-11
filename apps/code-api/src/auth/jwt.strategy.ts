import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

export interface CognitoUser {
  sub: string;
  email: string;
  'cognito:username'?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService) {
    const region = cfg.get<string>('aws.region')!;
    const userPoolId = cfg.get<string>('cognito.userPoolId')!;
    const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // jwks-rsa fetches Cognito public keys once and caches them
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
      algorithms: ['RS256'],
    });
  }

  validate(payload: CognitoUser): CognitoUser {
    return payload;
  }
}
