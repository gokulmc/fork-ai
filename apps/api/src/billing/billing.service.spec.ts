import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignedDataVerifier } from '@apple/app-store-server-library';
import { BillingService } from './billing.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { EmailService } from '@/email/email.service';

const mockDb = {
  getPayment: jest.fn(),
  putPayment: jest.fn(),
  addCredit: jest.fn(),
  putCreditEvent: jest.fn(),
  getUserMeta: jest.fn(),
};

const mockEmail = { sendPaymentReceipt: jest.fn() };

// apple.iapBundleId always has a default; apple.appAppleId is left unset so the
// service only attempts the sandbox verifier (matches "App Review always uses sandbox").
const mockCfg = {
  get: jest.fn((key: string) => (key === 'apple.iapBundleId' ? 'in.forkai.app' : undefined)),
};

const SUB = 'user-sub-123';

describe('BillingService — IAP verification', () => {
  let service: BillingService;
  let verifySpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.getUserMeta.mockResolvedValue(null); // silences the fire-and-forget receipt lookup

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: ConfigService, useValue: mockCfg },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();
    service = module.get<BillingService>(BillingService);

    verifySpy = jest.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction');
  });

  afterEach(() => {
    verifySpy.mockRestore();
  });

  it('credits the buyer once for a valid jws', async () => {
    verifySpy.mockResolvedValue({ bundleId: 'in.forkai.app', productId: 'credits_5', transactionId: 'apple-txn-1' });
    mockDb.getPayment.mockResolvedValue(null);

    const result = await service.verifyIapPurchase(SUB, 'fake-jws');

    expect(result).toEqual({ credited: 5.0 });
    expect(mockDb.addCredit).toHaveBeenCalledWith(SUB, 5.0);
    expect(mockDb.putPayment).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on a replayed transactionId — credits zero additional', async () => {
    verifySpy.mockResolvedValue({ bundleId: 'in.forkai.app', productId: 'credits_10', transactionId: 'apple-txn-2' });
    mockDb.getPayment.mockResolvedValue({ paymentId: 'apple-txn-2', amountUsd: 10.0 });

    const result = await service.verifyIapPurchase(SUB, 'fake-jws');

    expect(result).toEqual({ credited: 10.0 });
    expect(mockDb.addCredit).not.toHaveBeenCalled();
    expect(mockDb.putPayment).not.toHaveBeenCalled();
  });

  it('rejects an unknown productId with 400', async () => {
    verifySpy.mockResolvedValue({ bundleId: 'in.forkai.app', productId: 'credits_99', transactionId: 'apple-txn-3' });

    await expect(service.verifyIapPurchase(SUB, 'fake-jws')).rejects.toThrow(HttpException);
    expect(mockDb.addCredit).not.toHaveBeenCalled();
  });

  it('rejects a bundle id mismatch with 400', async () => {
    verifySpy.mockResolvedValue({ bundleId: 'com.other.app', productId: 'credits_5', transactionId: 'apple-txn-4' });

    await expect(service.verifyIapPurchase(SUB, 'fake-jws')).rejects.toThrow(HttpException);
    expect(mockDb.addCredit).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable jws with 400', async () => {
    verifySpy.mockRejectedValue(new Error('signature invalid'));

    await expect(service.verifyIapPurchase(SUB, 'garbage')).rejects.toThrow(HttpException);
    expect(mockDb.addCredit).not.toHaveBeenCalled();
  });
});
