/**
 * 统一鉴权失败 UI（403 Forbidden）
 *
 * 所有 layout.tsx 中 requirePermission 返回 null 时渲染此组件。
 */
export function Forbidden() {
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-red-500">未授权访问或权限不足</p>
    </div>
  );
}
