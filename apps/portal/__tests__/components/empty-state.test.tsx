/**
 * EmptyState 组件测试
 *
 * @req D-PRM-U, R2
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';

describe('EmptyState', () => {
  describe('simple variant', () => {
    it('渲染图标、标题和描述', () => {
      render(
        <EmptyState
          variant="simple"
          icon={ShieldCheck}
          title="暂无数据"
          description="还没有任何记录"
        />
      );

      expect(screen.getByText('暂无数据')).toBeInTheDocument();
      expect(screen.getByText('还没有任何记录')).toBeInTheDocument();
    });

    it('渲染 CTA 按钮（label + href）', () => {
      render(
        <EmptyState
          variant="simple"
          icon={ShieldCheck}
          title="暂无数据"
          description="还没有任何记录"
          action={{ label: '创建', href: '/create' }}
        />
      );

      const link = screen.getByRole('link', { name: '创建' });
      expect(link).toHaveAttribute('href', '/create');
    });

    it('渲染 CTA 按钮（label + onClick）', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();

      render(
        <EmptyState
          variant="simple"
          icon={ShieldCheck}
          title="暂无数据"
          description="还没有任何记录"
          action={{ label: '创建', onClick }}
        />
      );

      await user.click(screen.getByRole('button', { name: '创建' }));
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('不传 action prop 时不渲染按钮区域', () => {
      render(
        <EmptyState
          variant="simple"
          icon={ShieldCheck}
          title="暂无数据"
          description="还没有任何记录"
        />
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('onboarding variant', () => {
    it('渲染步骤 Checklist', () => {
      render(
        <EmptyState
          variant="onboarding"
          icon={ShieldCheck}
          title="欢迎使用"
          description="完成以下步骤"
          steps={[
            { label: '创建组织', href: '/dept' },
            { label: '创建用户', href: '/users' },
          ]}
        />
      );

      expect(screen.getByText('创建组织')).toBeInTheDocument();
      expect(screen.getByText('创建用户')).toBeInTheDocument();
    });

    it('步骤链接指向正确的 href', () => {
      render(
        <EmptyState
          variant="onboarding"
          icon={ShieldCheck}
          title="欢迎使用"
          description="完成以下步骤"
          steps={[
            { label: '创建组织', href: '/dept' },
          ]}
        />
      );

      expect(screen.getByRole('link', { name: /创建组织/ })).toHaveAttribute('href', '/dept');
    });

    it('空 steps 数组时不渲染步骤列表', () => {
      render(
        <EmptyState
          variant="onboarding"
          icon={ShieldCheck}
          title="欢迎使用"
          description="完成以下步骤"
          steps={[]}
        />
      );

      expect(screen.getByText('欢迎使用')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });
});
