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
 * 激活标签以 2px focus 蓝下缘窄条标识(语义窄条,非整块填充),其余标签下缘透明。
 * 全部用 CSS 变量令牌,无硬编码色值;标签超高时横向滚动。
 */
export function SessionTabs({ sessions, activeId, onSelect, onClose, onCreate }: SessionTabsProps) {
  return (
    <div
      data-testid="session-tabs"
      className="flex h-[34px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-[var(--hairline)] bg-[var(--bg-0)] px-1"
    >
      {sessions.map((session) => {
        const active = session.id === activeId;
        return (
          <div
            key={session.id}
            data-active={active ? "true" : "false"}
            className={
              "flex items-center gap-1 border-b-2 pl-2 text-[13px] " +
              (active
                ? "border-[var(--focus)] text-[var(--text-0)]"
                : "border-transparent text-[var(--text-1)]")
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
            {/* 关闭 ×:仅删除该标签对应会话 */}
            <button
              type="button"
              aria-label={`关闭 ${session.label}`}
              onClick={() => onClose(session.id)}
              className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center text-[var(--text-1)]"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
      {/* 新建 +:始终位于标签末尾 */}
      <button
        type="button"
        aria-label="新建会话"
        onClick={onCreate}
        className="flex w-[28px] shrink-0 cursor-pointer items-center justify-center text-[var(--text-1)]"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
