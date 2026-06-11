# Base image
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY . .
# 针对 Monorepo 只构建特定子应用
RUN pnpm config set registry https://registry.npmmirror.com

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_IDP_URL
ARG NEXT_PUBLIC_REDIRECT_URI

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL
ENV NEXT_PUBLIC_REDIRECT_URI=$NEXT_PUBLIC_REDIRECT_URI

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @auth-sso/portal build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/portal/public ./apps/portal/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/static ./apps/portal/.next/static

USER nextjs

EXPOSE 4000
ENV PORT=4000
CMD ["node", "apps/portal/server.js"]
