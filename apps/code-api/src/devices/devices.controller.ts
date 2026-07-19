import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Register (or refresh) an APNs device token for push notifications' })
  register(@CurrentUser() user: CognitoUser, @Body() dto: CreateDeviceDto) {
    return this.devicesService.register(user.sub, dto);
  }

  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister a device token' })
  @ApiParam({ name: 'token', description: 'APNs device push token' })
  unregister(@CurrentUser() user: CognitoUser, @Param('token') token: string) {
    return this.devicesService.unregister(user.sub, token);
  }
}
