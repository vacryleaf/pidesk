import type { ReactNode } from "react";
import { MessageSquare, Workflow, Play, Settings } from "lucide-react";

export type NavShellProps = {
  children: ReactNode;
  /** 传入则「配置」项启用为可点击(T11b:打开模型连接设置弹层);缺省保持禁用占位 */
  onOpenSettings?(): void;
};

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
 *
 * 密度对齐 Codex 系规范:导航行高 30px、圆角 10px(--radius-row)、
 * 水平内边距 8px、图标 16px、图标-文字间距 6px、文本 14px(--text-base)、
 * 字重 --font-weight-ui;hover/激活用中性内表面(bg-2),激活项保留 focus 蓝 2px 左窄条。
 */
export function NavShell({ children, onOpenSettings }: NavShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-1)]">
      {/* 左侧导航栏:固定 220px,bg-0,右缘 1px hairline */}
      <nav className="flex w-[220px] shrink-0 flex-col gap-[2px] border-r border-[var(--hairline)] bg-[var(--bg-0)] px-2 py-3">
        {NAV_ITEMS.map(({ key, label, Icon, active }) => {
          // 配置项:传入 onOpenSettings 时启用(T11b),其余项维持原激活/禁用逻辑
          const enabled = key === "settings" ? Boolean(onOpenSettings) : active;
          const settingsEnabled = key === "settings" && enabled;
          return (
            <button
              key={key}
              type="button"
              disabled={!enabled}
              aria-current={active ? "page" : undefined}
              onClick={settingsEnabled ? onOpenSettings : undefined}
              className={
                // 行高 30px、圆角 10px、水平内边距 8px、图标-文字间距 6px、文本 14px、字重 --font-weight-ui(fallback normal)
                // 激活态:focus 蓝 2px 左侧窄条 + bg-2 内表面 + text-0;启用配置项同为 text-0 可点击;禁用态:text-1 色
                "flex h-[30px] w-full items-center gap-[6px] rounded-[var(--radius-row)] px-2 text-left text-[length:var(--text-base)] leading-[var(--lh-base)] font-[var(--font-weight-ui,normal)] " +
                (active
                  ? "cursor-pointer border-l-2 border-[var(--focus)] bg-[var(--bg-2)] text-[var(--text-0)]"
                  : settingsEnabled
                    ? "cursor-pointer border-l-2 border-transparent text-[var(--text-0)] hover:bg-[var(--bg-2)]"
                    : "cursor-default border-l-2 border-transparent text-[var(--text-1)]")
              }
            >
              {/* 图标 16px,禁用态继承父级 text-1 色,激活/启用态用 text-0 */}
              <Icon
                size={16}
                strokeWidth={1.5}
                className={
                  active || settingsEnabled
                    ? "text-[var(--text-0)]"
                    : "text-[var(--text-1)]"
                }
              />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 主工作区:占满剩余空间,bg-1 */}
      <main className="min-w-0 flex-1 bg-[var(--bg-1)]">{children}</main>
    </div>
  );
}
