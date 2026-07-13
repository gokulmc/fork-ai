import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LinkInstallationDto {
  @ApiProperty({ description: 'GitHub App installation id, read from the ?installation_id= query param on the post-install redirect' })
  @IsString()
  @MinLength(1)
  installationId!: string;
}
