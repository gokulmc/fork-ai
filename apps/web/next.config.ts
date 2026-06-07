import type { NextConfig } from 'next';
import createMDX from '@next/mdx';
import { withSentryConfig } from '@sentry/nextjs';

// Amplify WEB_COMPUTE Lambda doesn't inject branch env vars at runtime.
// Baking these server-side values at build time (build env DOES have them).
const nextConfig: NextConfig = {
  // Let .md/.mdx files under app/ and imported MDX content compile as pages.
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
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

// Plugins passed as string names (not imported fns) so the config stays
// serialisable for both the webpack and Turbopack MDX loaders.
const withMDX = createMDX({
  options: {
    remarkPlugins: [['remark-gfm']],
    rehypePlugins: [['rehype-slug'], ['rehype-autolink-headings', { behavior: 'wrap' }]],
  },
});

// Outermost wrap. Source-map upload only runs when SENTRY_AUTH_TOKEN is present
// (CI/prod), so local and Amplify builds without it stay green. Sentry itself is
// a no-op at runtime unless NEXT_PUBLIC_SENTRY_DSN is set.
export default withSentryConfig(withMDX(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
