import { Controller, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Register (or refresh) an APNs push token for the current user' })
  register(@CurrentUser() user: CognitoUser, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(user.sub, dto);
  }

  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a device push token (e.g. on logout)' })
  @ApiParam({ name: 'token', description: 'APNs device push token' })
  remove(@CurrentUser() user: CognitoUser, @Param('token') token: string) {
    return this.devicesService.remove(user.sub, token);
  }
}
