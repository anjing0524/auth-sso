---
title: Vercel Deployment Path Collision and Next.js 16 Type Errors in Monorepo
date: 2026-04-07
last_updated: 2026-04-08
category: docs/solutions/build-errors/
module: Deployment
problem_type: build_error
component: tooling
symptoms:
  - Vercel deployment "path does not exist" errors
  - Next.js 16 build failures due to params type mismatch
  - OAuth flow broken by newline characters in environment variables
root_cause: config_error
resolution_type: workflow_improvement
severity: critical
tags: [vercel, monorepo, nextjs-16, typescript, oauth, env-vars]
---

# Vercel Deployment Path Collision and Next.js 16 Type Errors in Monorepo

## Problem
In a monorepo setup, Vercel CLI deployments for sub-apps (`apps/portal`, `apps/idp`) failed due to path collisions between the local CLI path and the Vercel Dashboard `Root Directory` setting. Additionally, Next.js 16 introduced breaking changes in route handler parameters, and hidden newline characters in environment variables broke authentication flows.

## Symptoms
- Vercel CLI outputting errors like `The provided path “.../apps/idp/apps/idp” does not exist`.
- Production builds failing with `Type '{ params: Promise<{ id: string; }>; }' is not assignable to type '{ params: { id: string; }; }'`.
- OAuth redirection URLs containing encoded newlines (e.g., `client_id=portal%0A`), leading to 404 or authorization failures.

## What Didn't Work
- Running `vercel deploy` inside sub-app directories: Failed because Vercel dashboard's `Root Directory` setting caused a path duplication (e.g., searching for `apps/idp` inside `apps/idp`).
- Deploying sub-apps in isolation: Failed because Vercel couldn't resolve root-level dependencies (e.g., `pnpm-lock.yaml`).

## Solution
1. **Unified Deployment Strategy**: Implemented a strategy to deploy from the workspace root by temporarily mapping the specific project's configuration.
2. **Next.js 16 Fix**: Updated all route handlers to use `Promise` for `params` and `await` them, as required by Next.js 16.
3. **Environment Sanitization**: Added `.trim()` to all sensitive environment variable reads in `apps/portal/src/lib/auth-client.ts`.
4. **Automation**: Created `scripts/deploy-all.sh` to automate the monorepo deployment process.

### Code Example (Next.js 16 Params Fix)
```typescript
// Before
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  // ...
}

// After
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

### Code Example (Env Sanitization)
```typescript
export const oauthConfig = {
  idpUrl: (process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4001').trim(),
  clientId: (process.env.NEXT_PUBLIC_CLIENT_ID || 'portal').trim(),
  // ...
};
```

## Why This Works
- Deploying from the root ensures Vercel has the full monorepo context and lockfiles.
- Next.js 16 requires async parameter access for better performance and future-proofing.
- `.trim()` removes hidden `\n` or `\r` characters that frequently occur when copying environment variables into `.env` files or CLI tools.

## Affected Files (补丁记录)

已修复的文件（Next.js 16 params Promise 类型）：
- `apps/portal/src/app/api/clients/[id]/route.ts` - 2026-04-07
- `apps/portal/src/app/api/clients/[id]/secret/route.ts` - 2026-04-07
- `apps/portal/src/app/api/clients/[id]/tokens/route.ts` - 2026-04-07
- `apps/portal/src/app/api/departments/[id]/route.ts` - 2026-04-07
- `apps/portal/src/app/api/roles/[id]/route.ts` - 2026-04-07
- `apps/portal/src/app/api/roles/[id]/permissions/route.ts` - 2026-04-07
- `apps/portal/src/app/api/roles/[id]/data-scopes/route.ts` - 2026-04-08 (遗漏补丁 commit 28cc758)
- `apps/portal/src/app/api/users/[id]/route.ts` - 2026-04-07
- `apps/portal/src/app/api/users/[id]/roles/route.ts` - 2026-04-07

## Prevention
- **Deployment**: Standardize deployment from the workspace root using the provided `scripts/deploy-all.sh`.
- **Typing**: Always define `params` as `Promise` in route handlers for Next.js 16+.
  - **关键提醒**: 动态路由文件 (`[id]/route.ts`) 需逐一检查，容易遗漏。使用 `grep -r "params: { id" apps/*/src/app/api/` 扫描遗漏文件。
- **Robustness**: Proactively use `.trim()` when loading critical environment variables like URLs and Client IDs.

## Related Issues
- Initial deployment failures on 2026-04-07.
- RBAC Data Scope implementation blockers.
