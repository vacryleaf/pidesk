import type { ReactNode } from "react";

/**
 * MessageItem —— 对话流单条消息:行头(角色名 + 右侧 token 计数 mono 12px)
 * + 正文 children;hairline 分隔;单列 ≤72ch、左对齐。
 */
export function MessageItem({
  role,
  tokens,
  children,
}: {
  role: "user" | "assistant";
  tokens?: number;
  children: ReactNode;
}) {
  return (
    <article className="border-b border-[var(--hairline)] py-3 text-left">
      {/* 行头:角色名(user=你 / assistant=pi)+ 右侧 token 计数 */}
      <header className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-[var(--text-1)]">{role === "user" ? "你" : "pi"}</span>
        {tokens != null && (
          <span className="font-mono text-[12px] text-[var(--text-1)]">{tokens} tok</span>
        )}
      </header>
      {/* 正文:≤72ch 单列,层积用 bg 令牌,无阴影 */}
      <div className="max-w-[72ch] text-[14px] leading-[1.5] text-[var(--text-0)]">{children}</div>
    </article>
  );
}
