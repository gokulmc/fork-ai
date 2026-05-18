import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn, MinLength, MaxLength } from 'class-validator';

export class CreateAnnotationDto {
  @ApiProperty({ enum: ['note', 'callout'], description: 'note = saved to drawer with highlight; callout = grey block below section' })
  @IsIn(['note', 'callout'])
  kind!: 'note' | 'callout';

  @ApiProperty({ description: 'The selected passage text' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ description: 'Display name of the source node (shown in drawer)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fromTitle!: string;

  @ApiProperty({ description: 'ID of the node the annotation belongs to' })
  @IsString()
  nodeId!: string;

  @ApiProperty({ description: 'ID of the section the annotation belongs to' })
  @IsString()
  sectionId!: string;
}
