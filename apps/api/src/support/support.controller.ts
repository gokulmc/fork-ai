import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Submit a support ticket' })
  send(@Body() dto: CreateSupportTicketDto): Promise<void> {
    return this.svc.send(dto);
  }
}
