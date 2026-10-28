/**
 * 必填标记与图例。
 *
 * 星号放在 `<Label>` **外部**：视觉上仍紧跟标签，但不会进入可访问名称，
 * 因此 `getByLabelText('字段名')` 等精确查询和读屏朗读保持稳定。
 */
export function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>;
}

export function RequiredLegend() {
  return <span className="whitespace-nowrap">（<RequiredMark /> 为必填）</span>;
}
