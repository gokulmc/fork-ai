import * as Joi from 'joi';

export const validationSchema = Joi.object({
  AWS_REGION: Joi.string().default('ap-south-1'),
  COGNITO_USER_POOL_ID: Joi.string().required(),
  COGNITO_CLIENT_ID: Joi.string().required(),
  DYNAMO_TABLE_NAME: Joi.string().default('forkai-main'),
  ANTHROPIC_API_KEY: Joi.string().required(),
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  DEEPSEEK_API_KEY: Joi.string().allow('').optional(),
  PORT: Joi.number().default(3000),
  NOTION_CLIENT_ID: Joi.string().optional(),
  NOTION_CLIENT_SECRET: Joi.string().optional(),
  NOTION_REDIRECT_URI: Joi.string().optional().default('http://localhost:3000/notion/callback'),
  FRONTEND_URL: Joi.string().optional().default('http://localhost:3001'),
  SIGNUP_CREDIT_USD: Joi.number().default(5.00),
  REFERRAL_CREDIT_USD: Joi.number().default(5.00),
  CREDIT_MULTIPLIER: Joi.number().default(1.5),
  RAZORPAY_KEY_ID: Joi.string().allow('').optional(),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').optional(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  TRIAL_HOUSE_SUB: Joi.string().allow('').optional(),
});

export const configuration = () => ({
  app: {
    commit: process.env.APP_COMMIT ?? process.env.CODEBUILD_RESOLVED_SOURCE_VERSION ?? 'dev',
    version: process.env.APP_VERSION ?? '0.1.0',
  },
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
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  },
  port: parseInt(process.env.PORT ?? '3000', 10),
  notion: {
    clientId: process.env.NOTION_CLIENT_ID ?? '',
    clientSecret: process.env.NOTION_CLIENT_SECRET ?? '',
    redirectUri: process.env.NOTION_REDIRECT_URI ?? 'http://localhost:3000/notion/callback',
  },
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  billing: {
    signupCreditUsd: parseFloat(process.env.SIGNUP_CREDIT_USD ?? '5.00'),
    referralCreditUsd: parseFloat(process.env.REFERRAL_CREDIT_USD ?? '5.00'),
    creditMultiplier: parseFloat(process.env.CREDIT_MULTIPLIER ?? '1.5'),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
});
