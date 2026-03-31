/**
 * Better Auth API 路由处理器
 * 默认路径: /api/auth/*
 *
 * 处理的端点:
 * - 认证: /api/auth/sign-in/email, /api/auth/sign-up/email 等
 * - Session: /api/auth/session, /api/auth/sign-out 等
 * - OIDC: /api/auth/oauth2/authorize, /api/auth/oauth2/token 等
 * - Well-known: /api/auth/.well-known/openid-configuration 等
 */
import { auth } from '../../../../lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);