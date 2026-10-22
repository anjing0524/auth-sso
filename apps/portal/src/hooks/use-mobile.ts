import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  /**
   * 初始值必须是**服务端与客户端首帧一致**的 `false`。
   *
   * 此前用 `useState(() => window.innerWidth < 768)`：SSR 时 window 不存在 ⇒ false，
   * 客户端 hydration 首帧在 390px 视口下直接算成 true ⇒ Sidebar 的渲染分支/文案不一致，
   * 移动端触发 React #418 hydration mismatch（实测 390px 下 /dashboard 报 pageerror）。
   * 正确做法：首帧 false，挂载后再用 matchMedia 校正。
   */
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
