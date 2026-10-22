/**
 * DataTable 组件测试
 *
 * @req R2
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from '@/components/shared/data-table';

interface TestItem {
  id: string;
  name: string;
}

const columns = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: '名称' },
];

const items: TestItem[] = [
  { id: '1', name: 'Foo' },
  { id: '2', name: 'Bar' },
];

const renderRow = (item: TestItem) => (
  <tr key={item.id}>
    <td>{item.id}</td>
    <td>{item.name}</td>
  </tr>
);

describe('DataTable', () => {
  it('渲染数据行', () => {
    render(
      <DataTable columns={columns} data={items} renderRow={renderRow} />
    );

    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(screen.getByText('Bar')).toBeInTheDocument();
  });

  it('loading=true 时显示骨架屏', () => {
    render(
      <DataTable columns={columns} data={[]} loading={true} skeletonRows={2} renderRow={renderRow} />
    );

    // 骨架屏渲染但不显示 "暂无数据"
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument();
  });

  it('数据为空时渲染 emptyText fallback', () => {
    render(
      <DataTable columns={columns} data={[]} emptyText="没有数据" renderRow={renderRow} />
    );

    expect(screen.getByText('没有数据')).toBeInTheDocument();
  });

  it('传入 emptyState 且数据为空时优先渲染 emptyState', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyText="没有数据"
        emptyState={<div>自定义空状态</div>}
        renderRow={renderRow}
      />
    );

    expect(screen.getByText('自定义空状态')).toBeInTheDocument();
    expect(screen.queryByText('没有数据')).not.toBeInTheDocument();
  });

  it('渲染 cardHeader 内容', () => {
    render(
      <DataTable
        columns={columns}
        data={items}
        renderRow={renderRow}
        cardHeader={<div>搜索栏测试</div>}
      />
    );

    expect(screen.getByText('搜索栏测试')).toBeInTheDocument();
  });
});
