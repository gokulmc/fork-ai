import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AttachRepoDto {
  @ApiProperty({ description: "Repo owner/org — must be covered by one of the caller's GitHub App installations" })
  @IsString()
  @MinLength(1)
  owner!: string;

  @ApiProperty({ description: 'Repo name' })
  @IsString()
  @MinLength(1)
  repo!: string;
}
