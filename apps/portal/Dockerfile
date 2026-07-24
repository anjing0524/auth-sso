# Base image
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@10.12.4

FROM base AS builder
WORKDIR /app

# 先复制依赖描述文件 → install → 利用 Docker layer caching（源码变更不重新下载依赖）
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json tsconfig.base.json next.base.ts vitest.base.ts ./
COPY apps/portal/package.json apps/portal/tsconfig.json apps/portal/next.config.ts ./apps/portal/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/config/package.json ./packages/config/

# The image already installs the version declared in packageManager. Disable
# pnpm's self-update check before its first invocation to keep builds offline-safe.
RUN printf 'manage-package-manager-versions=false\nregistry=https://registry.npmmirror.com\n' > .npmrc

ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN pnpm install --frozen-lockfile

# 再复制全部源码 → 构建
COPY . .
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
ENV HOSTNAME=0.0.0.0
CMD ["node", "--harmony-temporal", "apps/portal/server.js"]
