import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

const verifyAndDecodeTransaction = jest.fn();

jest.mock('@apple/app-store-server-library', () => {
  const actual = jest.requireActual('@apple/app-store-server-library');
  return {
    ...actual,
    SignedDataVerifier: jest.fn().mockImplementation(() => ({ verifyAndDecodeTransaction })),
  };
});

const mockDb = {
  getPayment: jest.fn(),
  putPayment: jest.fn(),
  putCreditEvent: jest.fn(),
  addCredit: jest.fn(),
};

const CFG: Record<string, string> = {
  'apple.iapBundleId': 'in.forkai.code',
};
const mockCfg = { get: jest.fn((key: string) => CFG[key]) };

const SUB = 'user-sub-123';
const JWS = 'signed.jws.token';

describe('BillingService — Apple IAP verification', () => {
  let service: BillingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.getPayment.mockResolvedValue(null);
    mockDb.putPayment.mockResolvedValue(undefined);
    mockDb.putCreditEvent.mockResolvedValue(undefined);
    mockDb.addCredit.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    service = module.get<BillingService>(BillingService);
  });

  it('credits the mapped USD amount for a valid production JWS', async () => {
    verifyAndDecodeTransaction.mockResolvedValue({
      bundleId: 'in.forkai.code',
      productId: 'code_credits_5',
      transactionId: 'txn-1',
    });

    const result = await service.verifyIapPurchase(SUB, JWS);

    expect(result).toEqual({ credited: 5.0 });
    expect(mockDb.addCredit).toHaveBeenCalledWith(SUB, 5.0);
    expect(mockDb.putPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'txn-1', sub: SUB, amountUsd: 5.0 }),
    );
    expect(mockDb.putCreditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sub: SUB, type: 'TOPUP', amountUsd: 5.0 }),
    );
  });

  it('falls back to the sandbox verifier when production verification fails (App Review path)', async () => {
    verifyAndDecodeTransaction
      .mockRejectedValueOnce(new Error('not a production transaction'))
      .mockResolvedValueOnce({
        bundleId: 'in.forkai.code',
        productId: 'code_credits_10',
        transactionId: 'txn-sandbox-1',
      });

    const result = await service.verifyIapPurchase(SUB, JWS);

    expect(result).toEqual({ credited: 10.0 });
    expect(verifyAndDecodeTransaction).toHaveBeenCalledTimes(2);
  });

  it('is idempotent on a replayed transactionId — credits once, second call is a no-op read', async () => {
    verifyAndDecodeTransaction.mockResolvedValue({
      bundleId: 'in.forkai.code',
      productId: 'code_credits_5',
      transactionId: 'txn-replay',
    });
    mockDb.getPayment.mockResolvedValue({ amountUsd: 5.0 });

    const result = await service.verifyIapPurchase(SUB, JWS);

    expect(result).toEqual({ credited: 5.0 });
    expect(mockDb.addCredit).not.toHaveBeenCalled();
    expect(mockDb.putPayment).not.toHaveBeenCalled();
  });

  it('rejects an unknown productId with 400', async () => {
    verifyAndDecodeTransaction.mockResolvedValue({
      bundleId: 'in.forkai.code',
      productId: 'not_a_real_product',
      transactionId: 'txn-2',
    });

    const err: HttpException = await service.verifyIapPurchase(SUB, JWS).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(mockDb.addCredit).not.toHaveBeenCalled();
  });

  it('rejects a JWS whose bundleId does not match ours with 400', async () => {
    verifyAndDecodeTransaction.mockResolvedValue({
      bundleId: 'com.someone.else',
      productId: 'code_credits_5',
      transactionId: 'txn-3',
    });

    const err: HttpException = await service.verifyIapPurchase(SUB, JWS).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(mockDb.addCredit).not.toHaveBeenCalled();
  });
});
