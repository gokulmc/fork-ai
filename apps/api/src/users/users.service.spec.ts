import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { UsersService } from './users.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { EmailService } from '@/email/email.service';

const mockDb = {
  listSessionMeta: jest.fn(),
  queryNodes: jest.fn(),
  queryAnnotations: jest.fn(),
  queryHighlights: jest.fn(),
  batchDeleteNodes: jest.fn(),
  batchDeleteAnnotations: jest.fn(),
  batchDeleteHighlights: jest.fn(),
  deleteUserPartition: jest.fn(),
};

const mockCfg = { get: jest.fn().mockReturnValue('ap-south-1_TESTPOOL') };
const mockEmail = { sendWelcome: jest.fn() };

const SUB = 'user-sub-1';

describe('UsersService.deleteAccount', () => {
  let service: UsersService;
  let sendSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.listSessionMeta.mockResolvedValue([{ sessionId: 's1' }, { sessionId: 's2' }]);
    mockDb.queryNodes.mockImplementation(async (sessionId: string) => [{ nodeId: `${sessionId}-node` }]);
    mockDb.queryAnnotations.mockImplementation(async (sessionId: string) => [{ annId: `${sessionId}-ann` }]);
    mockDb.queryHighlights.mockImplementation(async (sessionId: string) => [{ hlId: `${sessionId}-hl` }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: ConfigService, useValue: mockCfg },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);

    sendSpy = jest.spyOn(CognitoIdentityProviderClient.prototype, 'send');
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it('deletes every session\'s content, wipes the USER# partition, and deletes the Cognito user', async () => {
    sendSpy.mockResolvedValue({});

    const result = await service.deleteAccount(SUB, 'cognito-username-1');

    expect(mockDb.batchDeleteNodes).toHaveBeenCalledWith('s1', ['s1-node']);
    expect(mockDb.batchDeleteNodes).toHaveBeenCalledWith('s2', ['s2-node']);
    expect(mockDb.batchDeleteAnnotations).toHaveBeenCalledWith('s1', ['s1-ann']);
    expect(mockDb.batchDeleteHighlights).toHaveBeenCalledWith('s1', ['s1-hl']);
    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: true });
  });

  it('still reports data deleted when the Cognito call fails', async () => {
    sendSpy.mockRejectedValue(new Error('AccessDeniedException'));

    const result = await service.deleteAccount(SUB, 'cognito-username-1');

    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: false });
  });

  it('skips the Cognito call when no username is on the token', async () => {
    const result = await service.deleteAccount(SUB, undefined);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(mockDb.deleteUserPartition).toHaveBeenCalledWith(SUB);
    expect(result).toEqual({ dataDeleted: true, cognitoDeleted: false });
  });
});
