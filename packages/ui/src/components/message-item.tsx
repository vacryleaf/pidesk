import type { ReactNode } from "react";

/**
 * MessageItem —— 对话流单条消息(Wegent §5.5):
 * assistant = 左对齐 prose,无卡片/气泡;user = 右对齐紧凑中性气泡(bg-2,radius 16px,≤85% 宽)。
 * 行头 12px text-2:角色名 + 右侧 token 计数(mono 12px)。
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
  // 行头:角色名(user=你 / assistant=pi)+ 右侧 token 计数
  const header = (
    <header className="mb-1 flex items-baseline justify-between">
      <span className="text-[12px] text-[var(--text-2)]">{role === "user" ? "你" : "pi"}</span>
      {tokens != null && (
        <span className="font-mono text-[12px] text-[var(--text-2)]">{tokens} tok</span>
      )}
    </header>
  );

  // user:右对齐紧凑中性气泡,行头置于气泡上方右对齐
  if (role === "user") {
    return (
      <article className="flex justify-end py-3 text-left">
        <div className="flex max-w-[85%] flex-col items-end">
          {header}
          <div className="rounded-[16px] bg-[var(--bg-2)] px-3 py-2 text-[14px] leading-[1.5] text-[var(--text-0)]">
            {children}
          </div>
        </div>
      </article>
    );
  }

  // assistant:左对齐 prose,通栏排版,不加卡片/气泡
  return (
    <article className="py-3 text-left">
      {header}
      {/* 正文:列宽由 MessageList 的 48rem 列约束,层积用 bg 令牌,无阴影 */}
      <div className="text-[14px] leading-[1.5] text-[var(--text-0)]">{children}</div>
    </article>
  );
}
