import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, IsOptional, IsIn } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 5.0, description: 'USD amount to top up (minimum $1)' })
  @IsNumber()
  @Min(1)
  amountUsd!: number;

  @ApiProperty({ example: 'USD', description: 'Payment currency: INR for India, USD for international', required: false })
  @IsOptional()
  @IsIn(['INR', 'USD'])
  currency?: 'INR' | 'USD';
}
