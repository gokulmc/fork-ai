import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { CognitoUser } from '@/auth/jwt.strategy';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly cognito: CognitoIdentityProviderClient;

  constructor(
    private readonly db: DynamoRepository,
    private readonly sessionsService: SessionsService,
    private readonly cfg: ConfigService,
  ) {
    this.cognito = new CognitoIdentityProviderClient({ region: this.cfg.get<string>('aws.region') });
  }

  // Data deletion always runs first and is never aborted by a Cognito failure
  // — a user who asked to be deleted must have their data gone even if the
  // Cognito call errors, so the response distinguishes the two outcomes.
  async deleteAccount(user: CognitoUser): Promise<{ dataDeleted: boolean; cognitoDeleted: boolean }> {
    const sessions = await this.db.listSessionMeta(user.sub);
    // Each session's own nodes/annotations/highlights live under a separate
    // SESSION#{id} partition — SessionsService.delete's existing BFS is what
    // removes those (and the SessionMetaItem row itself).
    await Promise.all(sessions.map((s) => this.sessionsService.delete(user.sub, s.sessionId)));
    // Everything else directly under USER#{sub} (user meta, devices, GitHub
    // installations, usage/credit events, payments, projects, holds, machine
    // bills) — see deleteUserPartition's own comment for the full list.
    await this.db.deleteUserPartition(user.sub);

    let cognitoDeleted = false;
    try {
      await this.cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.cfg.get<string>('cognito.userPoolId'),
          Username: user['cognito:username'] ?? user.sub,
        }),
      );
      cognitoDeleted = true;
    } catch (err) {
      this.logger.error(`Cognito AdminDeleteUser failed for sub=${user.sub}: ${String(err)}`);
    }

    return { dataDeleted: true, cognitoDeleted };
  }
}
