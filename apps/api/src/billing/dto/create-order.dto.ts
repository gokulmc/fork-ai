import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 5.0, description: 'USD amount to top up (minimum $1)' })
  @IsNumber()
  @Min(1)
  amountUsd!: number;
}
