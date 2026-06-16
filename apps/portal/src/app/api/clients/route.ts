/**
 * Client 管理 API (REST 薄 Controller)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/infrastructure/db';
import { ilike, eq, or, desc, and, sql as drizzleSql } from 'drizzle-orm';
import { withPermission } from '@/lib/auth';
import { createClient, clientToInsertRow, parseRedirectUris } from '@/domain/client/client';
import { CreateClientInputSchema } from '@/domain/client/types';
import { generateId, generateClientId, generateClientSecret } from '@/lib/crypto';
import { mapDomainError } from '@/domain/shared/error-mapping';

export const runtime = 'nodejs';

/** GET /api/clients */
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['client:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const page = parseInt(sp.get('page') || '1', 10);
    const pageSize = parseInt(sp.get('pageSize') || '20', 10);
    const keyword = sp.get('keyword') || '';
    const status = sp.get('status') || '';

    const conditions = [];
    if (keyword) conditions.push(or(ilike(schema.clients.name, `%${keyword}%`), ilike(schema.clients.clientId, `%${keyword}%`)));
    if (status === 'ACTIVE' || status === 'DISABLED') conditions.push(eq(schema.clients.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const countResult = await db.select({ count: drizzleSql`COUNT(*)::int` }).from(schema.clients).where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const rows = await db.select().from(schema.clients).where(whereClause)
      .orderBy(desc(schema.clients.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

    return NextResponse.json({
      data: rows.map(c => ({
        id: c.id, publicId: c.publicId, name: c.name, clientId: c.clientId,
        redirectUris: parseRedirectUris(c.redirectUrls),
        scopes: c.scopes, homepageUrl: c.homepageUrl, logoUrl: c.icon,
        status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  });
}

/** POST /api/clients */
export async function POST(request: NextRequest) {
  return withPermission(request, { permissions: ['client:create'] }, async () => {
    const body = await request.json();
    const parsed = CreateClientInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message }, { status: 400 });
    }

    const client = createClient(parsed.data, generateId, generateClientId, generateClientSecret);
    await db.insert(schema.clients).values(clientToInsertRow(client));

    return NextResponse.json({
      success: true,
      data: { id: client.publicId, clientId: client.clientId, clientSecret: client.clientSecret },
    }, { status: 201 });
  });
}
