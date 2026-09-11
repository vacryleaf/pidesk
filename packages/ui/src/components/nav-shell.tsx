import type { ReactNode } from "react";
import { MessageSquare, Workflow, Play, Settings } from "lucide-react";

export type NavShellProps = {
  children: ReactNode;
  /** 当前激活的一级导航 key(如 "sessions"|"settings");缺省 "sessions" */
  activeKey?: string;
  /** 传入则「配置」项启用为可点击(T11b:打开模型连接设置弹层);缺省保持禁用占位 */
  onOpenSettings?(): void;
  /** 传入则「会话」项启用为可点击(从配置中心返回会话视图);缺省保持禁用占位 */
  onOpenSessions?(): void;
  /** 内容区不加圆角面板(配置态:ConfigCenter 自带二级菜单/内容双面板),缺省 false */
  contentBare?: boolean;
};

// 导航项定义:激活(会话)与禁用(其余三个,本阶段不可点击)
const NAV_ITEMS = [
  { key: "sessions", label: "会话", Icon: MessageSquare, active: true },
  { key: "workflows", label: "工作流", Icon: Workflow, active: false },
  { key: "runs", label: "运行", Icon: Play, active: false },
  { key: "settings", label: "配置", Icon: Settings, active: false },
] as const;

/**
 * NavShell —— 应用壳布局:左 240px 导航栏(bg-0)+ 主工作区(bg-1),
 * 两者以 1px hairline 分隔。全部用 CSS 变量令牌,无硬编码色值。
 *
 * 密度对齐 Wegent DesktopSidebar:导航行高 30px、圆角 10px、水平内边距 8px、
 * 图标 16px、文本 14px;激活项用中性表面叠加(--surface-active)+ text-0,
 * 禁用项 text-1;无 hover 效果(鼠标移入不改变样式)。
 */
export function NavShell({ children, onOpenSettings, onOpenSessions, activeKey, contentBare }: NavShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full gap-2 bg-transparent">
      {/* 左侧导航:圆角矩阵面板 */}
      <nav className="flex w-[200px] shrink-0 flex-col rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-0)] p-2">
        {NAV_ITEMS.map(({ key, label, Icon, active }) => {
          // 激活项由外部 activeKey 决定(缺省 "sessions");禁用逻辑保持不变
          const isActive = key === (activeKey ?? "sessions");
          // 「会话」「配置」传入对应回调时启用;workflows/runs 维持禁用占位
          const enabled =
            key === "sessions"
              ? Boolean(onOpenSessions)
              : key === "settings"
                ? Boolean(onOpenSettings)
                : active;
          const clickable = enabled ? (key === "sessions" ? onOpenSessions : onOpenSettings) : undefined;
          return (
            <button
              key={key}
              type="button"
              disabled={!enabled}
              aria-current={isActive ? "page" : undefined}
              onClick={clickable}
              className={
                // 行高 30px、圆角 10px、水平内边距 8px、图标-文字间距 6px、文本 14px
                // 激活/启用配置项:text-0;禁用态:text-1 色;无 hover
                "flex h-[30px] w-full items-center gap-2 rounded-[10px] px-2 text-left text-[14px] leading-5 " +
                (isActive
                  ? "bg-[var(--surface-active)] text-[var(--text-0)]"
                  : clickable
                    ? "bg-transparent text-[var(--text-0)]"
                    : "bg-transparent text-[var(--text-1)]")
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
      <main
        className={
          contentBare
            ? "flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
            : "flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-1)]"
        }
      >
        {children}
      </main>
    </div>
  );
}
