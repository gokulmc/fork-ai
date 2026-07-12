# Build stage — full workspace so tsc can resolve all types
FROM public.ecr.aws/docker/library/node:22-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/code-api/package.json apps/code-api/package.json
RUN npm ci --no-audit --no-fund

COPY apps/code-api/ apps/code-api/
WORKDIR /repo/apps/code-api
# Compile TypeScript, then rewrite @/ aliases to relative paths so dist/ is self-contained
RUN npx tsc -p tsconfig.build.json && npx tsc-alias -p tsconfig.build.json

# Production stage — standalone install, no dev deps, no source
FROM public.ecr.aws/docker/library/node:22-alpine
WORKDIR /app

COPY apps/code-api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /repo/apps/code-api/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/main"]
