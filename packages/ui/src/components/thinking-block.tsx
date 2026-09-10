import { useState } from "react";

/**
 * ThinkingBlock —— 思考块:默认折叠,摘要行「▸ 思考 · N 字」(text-2 12px);
 * 展开区用 pre 包裹 thinking 全文(12px text-2,bg-2 灰阶层积 + 8px 圆角,无阴影)。
 */
export function ThinkingBlock({
  text,
  defaultOpen = false,
}: {
  text: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="my-1">
      {/* 折叠摘要行:点击切换展开态 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-[12px] text-[var(--text-2)]"
      >
        {open ? "▾" : "▸"} 思考 · {text.length} 字
      </button>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded-[8px] bg-[var(--bg-2)] p-2 text-[12px] leading-relaxed text-[var(--text-2)]">
          {text}
        </pre>
      )}
    </div>
  );
}
