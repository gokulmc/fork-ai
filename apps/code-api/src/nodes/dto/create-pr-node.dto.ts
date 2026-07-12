import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreatePrNodeDto {
  @ApiProperty({ description: 'ID of the source CODE node — the commit to merge' })
  @IsString()
  @MinLength(1)
  sourceNodeId!: string;

  @ApiProperty({ description: "ID of the target node — the PR opens onto that node's branch tip" })
  @IsString()
  @MinLength(1)
  targetNodeId!: string;
}
