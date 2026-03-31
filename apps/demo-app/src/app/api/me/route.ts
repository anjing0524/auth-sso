/**
 * 用户信息 API
 * GET /api/me - 获取当前登录用户信息
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * GET /api/me
 * 获取当前登录用户信息
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      data: {
        userId: session.userId,
        email: session.email,
        name: session.name,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error('[DemoApp] Me Error:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取用户信息失败' },
      { status: 500 }
    );
  }
}