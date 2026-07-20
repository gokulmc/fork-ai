import * as Joi from 'joi';

function decodeApnsKey(raw: string): string {
  if (!raw) return '';
  if (!raw.includes('BEGIN')) return Buffer.from(raw, 'base64').toString('utf8');
  return raw.replace(/\\n/g, '\n');
}

export const validationSchema = Joi.object({
  AWS_REGION: Joi.string().default('ap-south-1'),
  COGNITO_USER_POOL_ID: Joi.string().required(),
  COGNITO_CLIENT_ID: Joi.string().required(),
  DYNAMO_TABLE_NAME: Joi.string().required(),
  ANTHROPIC_API_KEY: Joi.string().required(),
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  DEEPSEEK_API_KEY: Joi.string().allow('').optional(),
  GLM_API_KEY: Joi.string().allow('').optional(),
  GROQ_API_KEY: Joi.string().allow('').optional(),
  GITHUB_APP_ID: Joi.string().allow('').optional(),
  GITHUB_APP_PRIVATE_KEY_B64: Joi.string().allow('').optional(),
  GITHUB_APP_SLUG: Joi.string().allow('').optional(),
  AGENT_RUNNER: Joi.string().valid('mock', 'local', 'cloud', 'blaxel').default('mock'),
  LOCAL_AGENT_REPO_PATH: Joi.string().allow('').optional(),
  LOCAL_AGENT_REPO_URL: Joi.string().allow('').optional(),
  LOCAL_AGENT_OPEN_VSCODE: Joi.string().allow('').optional(),
  LOCAL_AGENT_KEEP_WORKSPACE: Joi.string().allow('').optional(),
  FLY_API_TOKEN: Joi.string().allow('').optional(),
  FLY_ORG: Joi.string().allow('').optional(),
  FLY_SANDBOX_IMAGE: Joi.string().allow('').optional(),
  FLY_REGION: Joi.string().allow('').optional(),
  FLY_REGIONS: Joi.string().allow('').optional(),
  SANDBOX_TTL_MINUTES: Joi.number().optional(),
  BLAXEL_API_TOKEN: Joi.string().allow('').optional(),
  BLAXEL_WORKSPACE: Joi.string().allow('').optional(),
  BLAXEL_SANDBOX_IMAGE: Joi.string().allow('').optional(),
  BLAXEL_REGION: Joi.string().allow('').optional(),
  BLAXEL_MEMORY_MB: Joi.number().optional(),
  PORT: Joi.number().default(3000),
  FRONTEND_URL: Joi.string().optional().default('http://localhost:3001'),
  SIGNUP_CREDIT_USD: Joi.number().default(5.00),
  CREDIT_MULTIPLIER: Joi.number().default(1.5),
  FLY_MINUTE_RATE_USD: Joi.number().default(0.0009),
  // Blaxel bills active compute per GB-second at a higher rate than Fly but
  // near-zero for standby storage — see billBlaxelMachineUsage. Rates are
  // per-minute (active) and per-GB-second (idle standby) to mirror Blaxel's own
  // pricing shape; defaults are the published 2026 figures × our margin.
  BLAXEL_ACTIVE_MINUTE_RATE_USD: Joi.number().default(0.0028),
  BLAXEL_STANDBY_GB_SECOND_RATE_USD: Joi.number().default(0.0000000772),
  MAX_RUN_COST_USD: Joi.number().default(1.00),
  SANDBOX_HOLD_USD: Joi.number().default(1.00),
  RAZORPAY_KEY_ID: Joi.string().allow('').optional(),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').optional(),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  APNS_KEY: Joi.string().allow('').optional(),
  APNS_KEY_ID: Joi.string().allow('').optional(),
  APNS_TEAM_ID: Joi.string().allow('').optional(),
  APNS_BUNDLE_ID: Joi.string().allow('').optional(),
  APNS_ENV: Joi.string().allow('').optional(),
  APNS_SECRET_NAME: Joi.string().allow('').optional(),
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
    tableName: process.env.DYNAMO_TABLE_NAME!,
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
  glm: {
    apiKey: process.env.GLM_API_KEY ?? '',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
  },
  githubApp: {
    appId: process.env.GITHUB_APP_ID ?? '',
    privateKeyB64: process.env.GITHUB_APP_PRIVATE_KEY_B64 ?? '',
    slug: process.env.GITHUB_APP_SLUG ?? '',
  },
  port: parseInt(process.env.PORT ?? '3000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  billing: {
    signupCreditUsd: parseFloat(process.env.SIGNUP_CREDIT_USD ?? '5.00'),
    creditMultiplier: parseFloat(process.env.CREDIT_MULTIPLIER ?? '1.5'),
    flyMinuteRateUsd: parseFloat(process.env.FLY_MINUTE_RATE_USD ?? '0.0009'),
    blaxelActiveMinuteRateUsd: parseFloat(process.env.BLAXEL_ACTIVE_MINUTE_RATE_USD ?? '0.0028'),
    blaxelStandbyGbSecondRateUsd: parseFloat(process.env.BLAXEL_STANDBY_GB_SECOND_RATE_USD ?? '0.0000000772'),
    blaxelMemoryGb: (Number(process.env.BLAXEL_MEMORY_MB ?? 4096)) / 1024,
    maxRunCostUsd: parseFloat(process.env.MAX_RUN_COST_USD ?? '1.00'),
    sandboxHoldUsd: parseFloat(process.env.SANDBOX_HOLD_USD ?? '1.00'),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  apns: {
    // Prod stores the p8 base64-encoded — a raw multi-line PEM breaks the EB
    // update-environment option-settings parsing (see buildspec.yml). Local env
    // files may still carry the PEM with literal `\n` sequences instead.
    key: decodeApnsKey(process.env.APNS_KEY ?? ''),
    keyId: process.env.APNS_KEY_ID ?? '',
    teamId: process.env.APNS_TEAM_ID ?? '',
    bundleId: process.env.APNS_BUNDLE_ID || 'in.forkai.code',
    env: process.env.APNS_ENV ?? '',
    secretName: process.env.APNS_SECRET_NAME ?? '',
  },
});
