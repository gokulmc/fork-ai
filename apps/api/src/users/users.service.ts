import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { UserMetaItem } from '@/dynamo/dynamo.interfaces';
import { CognitoUser } from '@/auth/jwt.strategy';

@Injectable()
export class UsersService {
  constructor(private readonly db: DynamoRepository) {}

  async upsert(user: CognitoUser): Promise<UserMetaItem> {
    const existing = await this.db.getUserMeta(user.sub);
    if (existing) return existing;

    const now = new Date().toISOString();
    const record: UserMetaItem = {
      PK: `USER#${user.sub}`,
      SK: 'METADATA',
      sub: user.sub,
      email: user.email,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.putUserMeta(record);
    return record;
  }

  async getMe(sub: string): Promise<UserMetaItem | null> {
    return this.db.getUserMeta(sub);
  }

  async patchMe(sub: string, updates: { hasOnboarded?: boolean }): Promise<void> {
    await this.db.updateUserMeta(sub, updates);
  }
}
