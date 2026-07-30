import {
  Controller,
  Post,
  Body,
  Req,
  RawBodyRequest,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { BillingService } from './billing.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { VerifyIapDto } from './dto/verify-iap.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Create a Razorpay order for credit top-up' })
  createOrder(
    @CurrentUser() user: CognitoUser,
    @Body() dto: CreateOrderDto,
  ) {
    return this.billing.createOrder(user.sub, dto.amountUsd, dto.currency);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify Razorpay payment signature and credit user' })
  verify(
    @CurrentUser() user: CognitoUser,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.billing.verifyAndCredit(user.sub, dto.orderId, dto.paymentId, dto.signature);
  }

  @Post('iap/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an Apple StoreKit 2 transaction JWS and credit the user' })
  verifyIap(
    @CurrentUser() user: CognitoUser,
    @Body() dto: VerifyIapDto,
  ) {
    return this.billing.verifyIapPurchase(user.sub, dto.jws);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook — payment.captured' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    await this.billing.handleWebhook(req.rawBody!, signature);
    return { received: true };
  }
}
