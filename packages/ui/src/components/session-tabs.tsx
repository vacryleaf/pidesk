import { Plus, X } from "lucide-react";

/** 标签数据:id 用于激活/关闭定位,label 为显示名(来自 store 的会话名) */
export type SessionTabItem = { id: string; label: string };

/** SessionTabs props:纯数据 + 回调,不依赖 store,可独立测试 */
export type SessionTabsProps = {
  sessions: SessionTabItem[];
  activeId: string | null;
  /** 点击标签切换激活会话 */
  onSelect(id: string): void;
  /** 点击 × 关闭会话 */
  onClose(id: string): void;
  /** 点击 + 新建会话 */
  onCreate(): void;
};

/**
 * SessionTabs —— 会话标签栏:横向标签(名称 + 关闭 ×)+ 新建按钮(+)。
 *
 * 密度对齐 Wegent TopBar:标签高 28px、外圆角 10px、水平内边距 8px、
 * 图标-文字间距 8px、文本 14px。激活标签用中性表面叠加(--surface-active)+ text-0;
 * 非激活透明 + text-1。无 hover 效果(鼠标移入不改变样式)。
 * 关闭 × 为按钮元素(键盘可达)28px 命中区,默认 text-1。
 * 全部用 CSS 变量令牌,无硬编码色值;标签超高时横向滚动。
 */
export function SessionTabs({ sessions, activeId, onSelect, onClose, onCreate }: SessionTabsProps) {
  return (
    <div
      data-testid="session-tabs"
      className="flex h-[52px] shrink-0 items-center gap-1 overflow-x-auto bg-[var(--bg-1)] px-6"
    >
      {sessions.map((session) => {
        const active = session.id === activeId;
        return (
          <div
            key={session.id}
            data-active={active ? "true" : "false"}
            className={
              // 标签:高 28px、外圆角 10px、水平内边距 8px、图标-文字间距 8px、文本 14px
              "flex h-[28px] shrink-0 items-center gap-2 rounded-[10px] px-2 text-[14px] leading-5 " +
              (active
                ? "bg-[var(--surface-active)] text-[var(--text-0)]"
                : "bg-transparent text-[var(--text-1)]")
            }
          >
            {/* 标签名:点击切换激活会话 */}
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              className="max-w-[160px] cursor-pointer truncate"
            >
              {session.label}
            </button>
            {/* 关闭 ×:仅删除该标签对应会话;28px 命中区 + 16px 图标,默认低调 */}
            <button
              type="button"
              aria-label={`关闭 ${session.label}`}
              onClick={() => onClose(session.id)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-1)]"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
      {/* 新建 +:28px 高图标按钮、8px 圆角,始终位于标签末尾 */}
      <button
        type="button"
        aria-label="新建会话"
        onClick={onCreate}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-1)]"
      >
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
