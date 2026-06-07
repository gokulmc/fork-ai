import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateBlogSubmissionDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'pending'] })
  @IsIn(['approved', 'rejected', 'pending'])
  status!: 'approved' | 'rejected' | 'pending';
}
