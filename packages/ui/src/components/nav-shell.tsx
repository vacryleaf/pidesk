import type { ReactNode } from "react";
import { MessageSquare, Workflow, Play, Settings } from "lucide-react";

// 导航项定义:激活(会话)与禁用(其余三个,本阶段不可点击)
const NAV_ITEMS = [
  { key: "sessions", label: "会话", Icon: MessageSquare, active: true },
  { key: "workflows", label: "工作流", Icon: Workflow, active: false },
  { key: "runs", label: "运行", Icon: Play, active: false },
  { key: "settings", label: "配置", Icon: Settings, active: false },
] as const;

/**
 * NavShell —— 应用壳布局:左 220px 导航栏(bg-0)+ 主工作区(bg-1),
 * 两者以 1px hairline 分隔。全部用 CSS 变量令牌,无硬编码色值。
 */
export function NavShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-1)]">
      {/* 左侧导航栏:固定 220px,bg-0,右缘 1px hairline */}
      <nav className="flex w-[220px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--bg-0)] px-2 py-3">
        {NAV_ITEMS.map(({ key, label, Icon, active }) => (
          <button
            key={key}
            type="button"
            disabled={!active}
            aria-current={active ? "page" : undefined}
            className={
              // 行高 30px;激活态:focus 蓝 2px 左侧窄条 + text-0;禁用态:text-1 色
              "flex h-[30px] w-full items-center gap-2 rounded-none text-left text-[13px] " +
              (active
                ? "cursor-pointer border-l-2 border-[var(--focus)] pl-2 text-[var(--text-0)]"
                : "cursor-default border-l-2 border-transparent pl-2 text-[var(--text-1)]")
            }
          >
            {/* 图标 16px,禁用态继承父级 text-1 色,激活态用 text-0 */}
            <Icon
              size={16}
              strokeWidth={1.5}
              className={active ? "text-[var(--text-0)]" : "text-[var(--text-1)]"}
            />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* 主工作区:占满剩余空间,bg-1 */}
      <main className="min-w-0 flex-1 bg-[var(--bg-1)]">{children}</main>
    </div>
  );
}
