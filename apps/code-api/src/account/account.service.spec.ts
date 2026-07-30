import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AccountService } from './account.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { CognitoUser } from '@/auth/jwt.strategy';

const send = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return {
    ...actual,
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send })),
  };
});

const mockDb = {
  listSessionMeta: jest.fn(),
  deleteUserPartition: jest.fn(),
};

const mockSessionsService = {
  delete: jest.fn(),
};

const CFG: Record<string, string> = {
  'aws.region': 'ap-south-1',
  'cognito.userPoolId': 'ap-south-1_TESTPOOL',
};
const mockCfg = { get: jest.fn((key: string) => CFG[key]) };

const SUB = 'user-sub-123';
const USER: CognitoUser = { sub: SUB, email: 'a@b.com', 'cognito:username': 'uuid-username' };

describe('AccountService', () => {
  let service: AccountService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.listSessionMeta.mockResolvedValue([{ sessionId: 's1' }, { sessionId: 's2' }]);
    mockDb.deleteUserPartition.mockResolvedValue(undefined);
    mockSessionsService.delete.mockResolvedValue(undefined);
    send.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: SessionsService, useValue: mockSessionsService },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    service = module.get<AccountService>(AccountService);
  });

  it('deletes every session, then the rest of the USER# partition, then the Cognito identity', async () => {
    const result = await service.deleteAccount(USER);

    expect(mockSessionsService.delete).toHaveBeenCalledWith(SUB, 's1');
    expect(mockSessionsService.delete).toHaveBeenCalledWith(SUB, 's2');
    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: true });
  });

  it('uses the cognito:username claim (not sub or email) as the AdminDeleteUser Username', async () => {
    await service.deleteAccount(USER);
    const command = send.mock.calls[0][0];
    expect(command.input.Username).toBe('uuid-username');
    expect(command.input.UserPoolId).toBe('ap-south-1_TESTPOOL');
  });

  it('falls back to sub when cognito:username is absent', async () => {
    await service.deleteAccount({ sub: SUB, email: 'a@b.com' });
    const command = send.mock.calls[0][0];
    expect(command.input.Username).toBe(SUB);
  });

  // Data deletion must never be rolled back or aborted by a downstream Cognito
  // failure — the user asked for their data gone, and that succeeded.
  it('reports dataDeleted:true, cognitoDeleted:false when the Cognito call throws, without rethrowing', async () => {
    send.mockRejectedValue(new Error('cognito unavailable'));

    const result = await service.deleteAccount(USER);

    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: false });
  });

  it('deletes nothing session-wise when the user has no sessions, but still clears the partition and Cognito', async () => {
    mockDb.listSessionMeta.mockResolvedValue([]);
    const result = await service.deleteAccount(USER);

    expect(mockSessionsService.delete).not.toHaveBeenCalled();
    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: true });
  });
});
