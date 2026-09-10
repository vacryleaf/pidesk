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
 * NavShell —— 应用壳布局:左 300px 导航栏(bg-0)+ 主工作区(bg-1),
 * 两者以 1px hairline 分隔。全部用 CSS 变量令牌,无硬编码色值。
 *
 * 密度对齐 Wegent DesktopSidebar:导航行高 30px、圆角 10px、水平内边距 8px、
 * 图标 16px、文本 14px;激活项用中性表面叠加(--surface-active)+ text-0,
 * 禁用项 text-1;无 hover 效果(鼠标移入不改变样式)。
 */
export function NavShell({ children, onOpenSettings }: NavShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-1)]">
      {/* 左侧导航栏:固定 300px(§5.3 默认宽),bg-0,右缘 1px hairline */}
      <nav className="relative flex h-full w-[300px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--bg-0)] px-1.5 pt-1.5">
        {/* 产品标题区 */}
        <div className="mb-1 flex h-9 shrink-0 items-center justify-between px-2">
          <span className="min-w-0 truncate text-[18px] font-semibold leading-6 text-[var(--text-0)]">pidesk</span>
        </div>
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
                // 行高 30px、圆角 10px、水平内边距 8px、图标-文字间距 6px、文本 14px
                // 激活/启用配置项:text-0;禁用态:text-1 色;无 hover
                "flex h-[30px] w-full items-center gap-2 rounded-[10px] px-2 text-left text-[14px] leading-5 " +
                (active
                  ? "cursor-pointer bg-[var(--surface-active)] text-[var(--text-0)]"
                  : settingsEnabled
                    ? "cursor-pointer bg-transparent text-[var(--text-0)]"
                    : "cursor-default bg-transparent text-[var(--text-1)]")
              }
            >
              {/* 图标 16px,继承父级文字色 */}
              <Icon size={16} strokeWidth={1.5} className="text-current" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 主工作区:占满剩余空间,bg-1 */}
      <main className="flex min-w-0 flex-1 flex-col bg-[var(--bg-1)]">{children}</main>
    </div>
  );
}
