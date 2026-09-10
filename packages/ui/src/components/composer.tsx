import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

/** Composer props:sending 发送中(按钮变中止、Enter 禁发);queueCounts 队列计数(仅 >0 显示) */
export type ComposerProps = {
  sending: boolean;
  queueCounts?: { steering: number; followUp: number };
  onSend(text: string): void;
  onAbort(): void;
};

/** 行高与最大行数:自动高度按内容撑开,封顶 6 行后内部滚动 */
const LINE_HEIGHT = 20;
const MAX_LINES = 6;
const TEXTAREA_MAX_H = LINE_HEIGHT * MAX_LINES;

/**
 * Composer —— 消息输入区:受控 textarea(自动高度 ≤6 行)+ 发送按钮。
 * Enter 发送 / Shift+Enter 换行;发送中按钮切 ⏹(Square)且点击调 onAbort;
 * 禁用渐变阴影,全部令牌用色:输入框 bg-2、hairline 边、队列提示 text-1 12px。
 */
export function Composer({ sending, queueCounts, onSend, onAbort }: ComposerProps) {
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
    <div className="flex flex-col gap-1">
      {/* 输入行:bg-2 底 + hairline 边,无渐变无阴影 */}
      <div className="flex items-end gap-2 border border-[var(--hairline)] bg-[var(--bg-2)] p-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="输入消息,Enter 发送,Shift+Enter 换行"
          style={{ lineHeight: `${LINE_HEIGHT}px`, maxHeight: TEXTAREA_MAX_H }}
          className="min-h-[20px] flex-1 resize-none bg-transparent text-[13px] text-[var(--text-0)] outline-none placeholder:text-[var(--text-1)]"
        />
        <button
          type="button"
          aria-label={sending ? "中止" : "发送"}
          onClick={() => (sending ? onAbort() : trySend())}
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-none border border-[var(--hairline)] text-[var(--text-0)]"
        >
          {/* sending 时切 ⏹(Square),否则 ↑(ArrowUp) */}
          {sending ? (
            <Square size={14} strokeWidth={1.5} className="text-[var(--text-0)]" />
          ) : (
            <ArrowUp size={14} strokeWidth={1.5} className="text-[var(--text-0)]" />
          )}
        </button>
      </div>
      {/* 队列计数提示:12px text-1,仅 >0 显示 */}
      {showQueue && (
        <div className="text-[12px] text-[var(--text-1)]">
          队列 · steering {steering} · followUp {followUp}
        </div>
      )}
    </div>
  );
}
