import type { NextConfig } from 'next';

// Amplify WEB_COMPUTE Lambda doesn't inject branch env vars at runtime.
// Baking these server-side values at build time (build env DOES have them).
const nextConfig: NextConfig = {
  env: {
    COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    // next-auth v5 reads AUTH_SECRET internally; bake it so node_modules gets it at runtime
    AUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_URL: process.env.NEXTAUTH_URL,
    AWS_REGION: process.env.AWS_REGION ?? 'ap-south-1',
  },
};

export default nextConfig;
