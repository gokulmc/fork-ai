import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DYNAMO_CLIENT } from './dynamo.constants';

@Injectable()
export class DynamoRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_CLIENT) private readonly client: DynamoDBDocumentClient,
    private readonly cfg: ConfigService,
  ) {
    this.table = this.cfg.get<string>('dynamo.tableName')!;
  }

  async put(item: Record<string, unknown>): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  async get(pk: string, sk: string): Promise<Record<string, unknown> | null> {
    const res = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { PK: pk, SK: sk } }),
    );
    return (res.Item as Record<string, unknown>) ?? null;
  }

  async query(
    pk: string,
    skPrefix?: string,
    opts: { indexName?: string; limit?: number; scanIndexForward?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    const keyCondition = skPrefix
      ? 'PK = :pk AND begins_with(SK, :sk)'
      : 'PK = :pk';
    const expressionValues: Record<string, unknown> = { ':pk': pk };
    if (skPrefix) expressionValues[':sk'] = skPrefix;

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: opts.indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        ScanIndexForward: opts.scanIndexForward ?? true,
        Limit: opts.limit,
      }),
    );
    return (res.Items as Record<string, unknown>[]) ?? [];
  }

  async queryGsi(
    indexName: string,
    gsi1pk: string,
    opts: { scanIndexForward?: boolean; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: indexName,
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': gsi1pk },
        ScanIndexForward: opts.scanIndexForward ?? false,
        Limit: opts.limit,
      }),
    );
    return (res.Items as Record<string, unknown>[]) ?? [];
  }

  async update(
    pk: string,
    sk: string,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const setExpressions: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrValues: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      const nameAlias = `#${key}`;
      const valueAlias = `:${key}`;
      setExpressions.push(`${nameAlias} = ${valueAlias}`);
      attrNames[nameAlias] = key;
      attrValues[valueAlias] = value;
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: pk, SK: sk },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: attrValues,
      }),
    );
  }

  async delete(pk: string, sk: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: pk, SK: sk } }),
    );
  }

  async batchDelete(keys: Array<{ pk: string; sk: string }>): Promise<void> {
    // DynamoDB batch write limit is 25 per call
    const chunks = [];
    for (let i = 0; i < keys.length; i += 25) {
      chunks.push(keys.slice(i, i + 25));
    }
    await Promise.all(
      chunks.map((chunk) =>
        this.client.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.table]: chunk.map(({ pk, sk }) => ({
                DeleteRequest: { Key: { PK: pk, SK: sk } },
              })),
            },
          }),
        ),
      ),
    );
  }
}
