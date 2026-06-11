# Base image
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm config set registry https://registry.npmmirror.com

ARG BETTER_AUTH_URL
ARG NEXT_PUBLIC_APP_URL

ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @auth-sso/idp build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/idp/public ./apps/idp/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/idp/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/idp/.next/static ./apps/idp/.next/static

USER nextjs

EXPOSE 4001
ENV PORT=4001
CMD ["node", "apps/idp/server.js"]
