/**
 * UI 结构回归守卫（2026-10-30 批量修复）
 *
 * 钉住这轮审计中容易被后续重构改回去的契约：
 * - 审计 operation 页签不得再用 svh 魔法数；
 * - DataTable 不再暴露无效 maxHeightClass；
 * - 客户端详情必须把总数传给 Token 区块；
 * - Dialog 关闭按钮必须在滚动区外；
 * - Select/Popover 使用可用高度变量。
 *
 * @req U-G02
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf-8');

describe('UI 结构回归', () => {
  it('审计 operation 页签与其他页签共用 flex 滚动，不再写死 svh', () => {
    const page = read('apps/portal/src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).not.toContain('max-h-[calc(100svh-19rem)]');
    // 短列表贴合内容，长列表才 flex-1；滚动容器本身始终可用
    expect(page).toContain("const listFlex = data.length <= 8");
    expect(page).toContain('scrollbar-slim min-h-0 overflow-auto ${listFlex}');
    expect(page).not.toContain('pagination.totalPages > 1 &&');
  });

  it('DataTable 不再保留未使用的 maxHeightClass', () => {
    const dataTable = read('apps/portal/src/components/shared/data-table.tsx');
    expect(dataTable).not.toContain('maxHeightClass');
  });

  it('客户端详情把 Token 总数传给区块', () => {
    const detail = read('apps/portal/src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx');
    expect(detail).toContain('total={initialTokenTotal}');
  });

  it('Dialog 关闭按钮在独立滚动区外', () => {
    const dialog = read('apps/portal/src/components/ui/dialog.tsx');
    expect(dialog).toContain('data-slot="dialog-scroll"');
    expect(dialog).toContain('absolute top-2 right-2 z-10');
    expect(dialog).toContain('max-h-[calc(100dvh-2rem)]');
  });

  it('下拉/浮层使用可用高度，不写死 24rem/96', () => {
    expect(read('apps/portal/src/components/ui/select.tsx')).toContain('--radix-select-content-available-height');
    expect(read('apps/portal/src/components/ui/popover.tsx')).toContain('--available-height');
  });

  it('clients 翻页使用受控 searchParams，不读 window.location', () => {
    const clients = read('apps/portal/src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).not.toContain('window.location.search');
    expect(clients).toContain("new URLSearchParams(searchParams.toString())");
  });

  it('个人资料弹窗每次打开以最新 props 重置', () => {
    const profile = read('apps/portal/src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(profile).toContain("if (next) setForm({ name: user.name, email: user.email, avatarUrl: user.picture ?? '' })");
  });

  it('侧边栏骨架使用 Tailwind v4 CSS 变量语法', () => {
    expect(read('apps/portal/src/components/ui/sidebar.tsx')).not.toContain('max-w-[--skeleton-width]');
    expect(read('apps/portal/src/components/ui/sidebar.tsx')).toContain('max-w-(--skeleton-width)');
  });
});
