import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { CognitoUser } from '@/auth/jwt.strategy';

export interface UserRecord {
  sub: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DynamoRepository) {}

  private pk(sub: string) {
    return `USER#${sub}`;
  }

  async upsert(user: CognitoUser): Promise<UserRecord> {
    const existing = await this.db.get(this.pk(user.sub), 'METADATA');
    if (existing) return existing as unknown as UserRecord;

    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      PK: this.pk(user.sub),
      SK: 'METADATA',
      sub: user.sub,
      email: user.email,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put(record);
    return record as unknown as UserRecord;
  }

  async getMe(sub: string): Promise<UserRecord | null> {
    const item = await this.db.get(this.pk(sub), 'METADATA');
    return item as unknown as UserRecord | null;
  }
}
