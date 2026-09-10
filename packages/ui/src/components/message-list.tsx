import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageItem } from "./message-item";
import { ThinkingBlock } from "./thinking-block";
import { ToolRow } from "./tool-row";

/** 工具调用视图:字段与 ToolRow 对齐,由会话层累积填充 */
export type ToolView = {
  toolName: string;
  status: "running" | "ok" | "err";
  argsPreview?: string;
  durationMs?: number;
  stderr?: string;
};

/** 消息流单条视图:id 供列表 key 使用;text 为正文(流式期间持续追加) */
export type MessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: ToolView[];
  tokens?: number;
};

/** 判定「用户已近底部」的距离阈值(px):小于该值才自动滚底,防抢滚动 */
const NEAR_BOTTOM_PX = 96;

/**
 * 正文增量渲染:react-markdown + remark-gfm;
 * prose 样式最小化 —— 仅 p/code/pre 基础排版,代码块 bg-2 + mono。
 */
function MarkdownBody({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        code: ({ children }) => (
          <code className="rounded-[var(--radius-sm)] bg-[var(--bg-2)] px-1 font-mono text-[12px]">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-[var(--radius-ctl)] bg-[var(--bg-2)] p-2 font-mono text-[12px] leading-[1.5]">
            {children}
          </pre>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}

/**
 * MessageList —— 流式消息列表容器:滚动通栏,内部消息列居中 48rem(20px gutter)。
 * 流式优化:text_delta 即 props.messages 高频变化,经 rAF(16ms)批量 flush 进 state,
 * 同一帧内多次增量只触发一次重渲;卸载时 cancelAnimationFrame 兜底。
 * 末条消息自动滚底,仅当滚动容器已在底部附近,避免打断用户回看。
 */
export function MessageList({ messages }: { messages: MessageView[] }) {
  // 已 flush 进渲染的消息;首帧直接取 props,避免首屏空窗
  const [flushed, setFlushed] = useState<MessageView[]>(messages);
  // 累积待渲染的最新消息(含未 flush 的 text 增量)
  const pendingRef = useRef<MessageView[]>(messages);
  // 在途 rAF 句柄;非 null 表示本帧已有批量 flush 排队
  const rafRef = useRef<number | null>(null);
  // 滚动容器与末条哨兵(滚底锚点)
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // props 变化(流式 delta):先积到 pendingRef,本帧已有排队则跳过,合帧批量 flush
  useEffect(() => {
    pendingRef.current = messages;
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setFlushed(pendingRef.current);
    });
  }, [messages]);

  // 卸载兜底:取消在途 rAF,避免卸后 setState
  useEffect(
    () => () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  // flush 后:仅当用户已在底部附近才把末条滚入视口,防止抢滚动
  useEffect(() => {
    const container = containerRef.current;
    const end = endRef.current;
    if (!container || !end) return;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom && typeof end.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end" });
    }
  }, [flushed]);

  return (
    <div ref={containerRef} data-testid="message-list" className="overflow-y-auto">
      {/* 滚动容器通栏;内部消息列居中 48rem + 20px gutter(Wegent §5.1/5.5) */}
      <div className="mx-auto w-full max-w-[48rem] px-5">
        {flushed.map((m) => (
          <MessageItem key={m.id} role={m.role} tokens={m.tokens}>
            {/* assistant 且 thinking 非空 → 折叠思考块 */}
            {m.role === "assistant" && m.thinking ? <ThinkingBlock text={m.thinking} /> : null}
            {/* 工具调用逐条可折叠行 */}
            {m.tools?.map((t, i) => (
              <ToolRow key={i} toolName={t.toolName} argsPreview={t.argsPreview} status={t.status} durationMs={t.durationMs} stderr={t.stderr} />
            ))}
            {/* 正文 markdown 增量渲染(批量 flush 驱动) */}
            <MarkdownBody text={m.text} />
          </MessageItem>
        ))}
        {/* 滚底哨兵:始终位于列表末尾(列内) */}
        <div ref={endRef} data-testid="message-list-end" />
      </div>
    </div>
  );
}
