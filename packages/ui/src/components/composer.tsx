import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";

/** Composer props:sending 发送中(按钮变中止、Enter 禁发);queueCounts 队列计数(仅 >0 显示) */
export type ComposerProps = {
  sending: boolean;
  queueCounts?: { steering: number; followUp: number };
  footerLeft?: ReactNode;
  placeholder?: string;
  onSend(text: string): void;
  onAbort(): void;
};

/** 行高与最大行数:默认两行(14px/21px)起步,自动高度按内容撑开,封顶 6 行后内部滚动 */
const LINE_HEIGHT = 21;
const MAX_LINES = 6;
const TEXTAREA_MAX_H = LINE_HEIGHT * MAX_LINES;

/**
 * Composer —— 消息输入区(Wegent ProjectChatComposer 双层结构):
 * 外层 rounded-[26px] bg-2 + 柔和投影;内层 rounded-[26px] hairline 描边 bg-1。
 * 受控 textarea(2 行起步,自动高度 ≤6 行)+ 底栏(左插槽 / 右圆形发送钮)。
 * Enter 发送 / Shift+Enter 换行;发送中按钮切 ⏹(Square)且点击调 onAbort;队列提示 12px text-2。
 */
export function Composer({
  sending,
  queueCounts,
  footerLeft,
  placeholder = "要求后续变更",
  onSend,
  onAbort,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自动高度:值变化时先归零再按 scrollHeight 撑开,封顶 6 行(jsdom 下 scrollHeight 恒 0,不影响测试)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_H)}px`;
  }, [value]);

  // 队列计数行:steering/followUp 任一 >0 才显示
  const steering = queueCounts?.steering ?? 0;
  const followUp = queueCounts?.followUp ?? 0;
  const showQueue = steering + followUp > 0;

  /** 发送:空文本(含纯空白)不发送;发送后清空输入 */
  const trySend = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return; // Shift+Enter 换行:走浏览器默认行为
    e.preventDefault(); // 阻止 Enter 在 textarea 里插换行
    if (sending) return; // 发送中 Enter 禁发
    trySend();
  };

  return (
    <div className="relative w-full rounded-[26px] bg-[var(--bg-0)] shadow-[0_0_0_0.5px_rgba(13,13,13,0.12),0_3px_7.5px_rgba(0,0,0,0.04),0_0_20px_rgba(0,0,0,0.05)]">
      {/* 内层:hairline 描边 + bg-1,与外层错位形成双层边缘 */}
      <div className="relative z-10 flex min-h-[76px] w-full flex-col rounded-[26px] border border-[var(--hairline)] bg-[var(--bg-1)] px-4 pb-1.5 pt-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={placeholder}
          style={{ lineHeight: `${LINE_HEIGHT}px`, maxHeight: TEXTAREA_MAX_H }}
          className="max-h-[112px] min-h-12 w-full resize-none overflow-y-auto bg-transparent px-0 pb-0 pt-1 text-[14px] leading-[1.57] text-[var(--text-0)] outline-none placeholder:text-[var(--text-2)]"
        />
        {/* 底栏:左侧插槽(如 ModelMenu)+ 右侧发送/中止按钮 */}
        <div className="mt-auto flex min-h-8 min-w-0 items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-center gap-2">{footerLeft}</div>
          <button
            type="button"
            aria-label={sending ? "中止" : "发送"}
            onClick={() => (sending ? onAbort() : trySend())}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--text-0)] p-0 text-[var(--bg-1)] disabled:bg-[var(--text-2)]"
          >
            {/* sending 时切 ⏹(Square),否则 ↑(ArrowUp) */}
            {sending ? (
              <Square size={16} />
            ) : (
              <ArrowUp size={16} />
            )}
          </button>
        </div>
      </div>
      {/* 队列计数提示:12px text-2,仅 >0 显示 */}
      {showQueue && (
        <div className="text-[12px] text-[var(--text-2)]">
          队列 · steering {steering} · followUp {followUp}
        </div>
      )}
    </div>
  );
}
