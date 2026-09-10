/**
 * MessageList 测试(T9b):
 * 多条消息渲染顺序 / 增量 rAF 批量 flush 合并 / 工具行 + thinking 集成出现 / 空列表渲染空容器。
 * 环境为 jsdom,沿用 T9a 风格:不引 testing-library,直接用 react-dom/client。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { MessageList, type MessageView } from "./message-list";

// React act 环境标记(jsdom 下必设,否则 act 告警)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 极简渲染助手:挂到 document.body,返回容器;支持 rerender/unmount */
function render(ui: ReactElement): {
  container: HTMLElement;
  root: Root;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    root,
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

/** 构造一条消息 */
function msg(partial: Partial<MessageView> & { id: string }): MessageView {
  return { role: "user", text: "", ...partial };
}

/** 自管假 rAF:待执行回调队列与 id 分配 */
let rafQueue = new Map<number, FrameRequestCallback>();
let rafNextId = 0;
/** 假 rAF 排队计数(可断言合帧) */
let rafCalls = 0;
let origRaf: typeof window.requestAnimationFrame;
let origCaf: typeof window.cancelAnimationFrame;

/** 执行一帧:清空队列并依次回调(模拟 16ms 帧推进) */
function runRafFrame(): void {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  act(() => {
    for (const cb of cbs) cb(performance.now());
  });
}

beforeEach(() => {
  // 假 rAF:替换 window 上的实现,计数排队次数;帧推进由 runRafFrame 手动驱动
  rafQueue = new Map();
  rafNextId = 0;
  rafCalls = 0;
  origRaf = window.requestAnimationFrame;
  origCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    rafCalls++;
    const id = ++rafNextId;
    rafQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    rafQueue.delete(id);
  };
  // jsdom 无 scrollIntoView,打桩防报错并断言调用
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.requestAnimationFrame = origRaf;
  window.cancelAnimationFrame = origCaf;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("MessageList", () => {
  it("多条消息按数组顺序渲染,角色名与正文齐全", () => {
    const messages = [
      msg({ id: "1", role: "user", text: "你好" }),
      msg({ id: "2", role: "assistant", text: "**你好!**有什么可以帮你" }),
    ];
    const { container, unmount } = render(<MessageList messages={messages} />);

    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(2);
    // 顺序:第一条行头是「你」,第二条是「pi」
    expect(articles.item(0)!.querySelector("header")!.textContent).toContain("你");
    expect(articles.item(1)!.querySelector("header")!.textContent).toContain("pi");
    // 正文 markdown 已渲染(p 标签)
    expect(articles.item(1)!.querySelector("p")!.textContent).toContain("有什么可以帮你");
    unmount();
  });

  it("增量 flush:同一帧内多次 text 增量合并为一次 flush", () => {
    const { container, rerender, unmount } = render(
      <MessageList messages={[msg({ id: "a", role: "assistant", text: "he" })]} />,
    );
    // 先走完挂载帧(消耗初始排队),后续只统计增量阶段
    runRafFrame();
    rafCalls = 0;

    // 同帧连续两次增量(模拟逐 token 到达),不推进帧
    rerender(<MessageList messages={[msg({ id: "a", role: "assistant", text: "hello" })]} />);
    rerender(<MessageList messages={[msg({ id: "a", role: "assistant", text: "hello world" })]} />);

    // flush 未发生:页面上仍只有初始文本,且两次增量只排队一次(合帧)
    expect(container.textContent).not.toContain("hello");
    expect(rafCalls).toBe(1);

    // 推进一帧 → 批量 flush 生效,一次落到最新文本
    runRafFrame();
    expect(container.textContent).toContain("hello world");
    expect(rafCalls).toBe(1); // 期间无额外排队
    unmount();
  });

  it("assistant 消息的 thinking 与 tools 集成出现(thinking-block / tool-row)", () => {
    const messages = [
      msg({
        id: "m1",
        role: "assistant",
        text: "结论如下",
        thinking: "先想想",
        tools: [{ toolName: "bash", status: "ok", argsPreview: "ls", durationMs: 12 }],
      }),
    ];
    const { container, unmount } = render(<MessageList messages={messages} />);

    // 思考块摘要 + 工具行(名称/参数/ok 态)均在
    expect(container.textContent).toContain("思考 · 3 字");
    expect(container.textContent).toContain("bash");
    expect(container.textContent).toContain("ls");
    expect(container.querySelector('[data-status="ok"]')).not.toBeNull();
    unmount();
  });

  it("空列表渲染空容器(无 article,仅哨兵)", () => {
    const { container, unmount } = render(<MessageList messages={[]} />);
    expect(container.querySelector('[data-testid="message-list"]')).not.toBeNull();
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(container.querySelector('[data-testid="message-list-end"]')).not.toBeNull();
    unmount();
  });
});
