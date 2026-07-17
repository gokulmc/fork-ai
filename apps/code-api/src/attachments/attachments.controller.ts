import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { AttachmentsService } from './attachments.service';
import { DescribeImageDto } from './dto/describe-image.dto';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('describe-image')
  @ApiOperation({ summary: 'Describe an uploaded image via Groq vision so it can flow through the text-attachment pipeline' })
  async describeImage(@CurrentUser() _user: CognitoUser, @Body() dto: DescribeImageDto): Promise<{ description: string }> {
    const description = await this.attachmentsService.describeImage(dto.dataUrl);
    return { description };
  }
}
