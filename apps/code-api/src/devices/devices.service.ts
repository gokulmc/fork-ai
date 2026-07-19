import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { CreateDeviceDto } from './dto/create-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly db: DynamoRepository) {}

  async register(sub: string, dto: CreateDeviceDto): Promise<{ token: string; platform: 'ios' }> {
    await this.db.putDevice(sub, dto.token, dto.platform);
    return { token: dto.token, platform: dto.platform };
  }

  async unregister(sub: string, token: string): Promise<void> {
    await this.db.deleteDevice(sub, token);
  }
}
