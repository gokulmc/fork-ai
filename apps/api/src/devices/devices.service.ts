import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly db: DynamoRepository) {}

  async register(sub: string, dto: RegisterDeviceDto): Promise<void> {
    await this.db.putDevice(sub, dto.token, dto.platform);
  }

  async remove(sub: string, token: string): Promise<void> {
    await this.db.deleteDevice(sub, token);
  }
}
