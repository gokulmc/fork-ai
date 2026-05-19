import * as Joi from 'joi';

export const validationSchema = Joi.object({
  AWS_REGION: Joi.string().default('ap-south-1'),
  COGNITO_USER_POOL_ID: Joi.string().required(),
  COGNITO_CLIENT_ID: Joi.string().required(),
  DYNAMO_TABLE_NAME: Joi.string().default('forkai-main'),
  ANTHROPIC_API_KEY: Joi.string().required(),
  PORT: Joi.number().default(3000),
  NOTION_CLIENT_ID: Joi.string().optional(),
  NOTION_CLIENT_SECRET: Joi.string().optional(),
  NOTION_REDIRECT_URI: Joi.string().optional().default('http://localhost:3000/notion/callback'),
  FRONTEND_URL: Joi.string().optional().default('http://localhost:3001'),
});

export const configuration = () => ({
  aws: {
    region: process.env.AWS_REGION ?? 'ap-south-1',
  },
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    clientId: process.env.COGNITO_CLIENT_ID!,
  },
  dynamo: {
    tableName: process.env.DYNAMO_TABLE_NAME ?? 'forkai-main',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  port: parseInt(process.env.PORT ?? '3000', 10),
  notion: {
    clientId: process.env.NOTION_CLIENT_ID ?? '',
    clientSecret: process.env.NOTION_CLIENT_SECRET ?? '',
    redirectUri: process.env.NOTION_REDIRECT_URI ?? 'http://localhost:3000/notion/callback',
  },
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
});
