/** 统一鉴权失败视图。 */
export function Forbidden() {
  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-red-500">未授权访问或权限不足</p>
    </div>
  );
}
