/**
 * 消息渲染三件组件测试(T9a):
 * 渲染断言 —— 折叠默认态 / 展开切换 / 三态样式类 / err 展开 stderr / token 计数显示。
 * 环境为 jsdom(vitest.config environment),不引 testing-library,直接用 react-dom/client。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { MessageItem } from "./message-item";
import { ThinkingBlock } from "./thinking-block";
import { ToolRow } from "./tool-row";

// React act 环境标记(jsdom 下必设,否则 act 告警)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 极简渲染助手:挂到 document.body,返回容器 */
function render(ui: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

/** 模拟点击(冒泡到 React 根监听) */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ThinkingBlock", () => {
  it("默认折叠:摘要行含字数,正文不可见", () => {
    const { container } = render(<ThinkingBlock text="一二三四五" />);
    const btn = container.querySelector("button");
    expect(btn?.textContent).toContain("▸ 思考 · 5 字");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("defaultOpen 时直接展开显示全文", () => {
    const { container } = render(<ThinkingBlock text="思考全文" defaultOpen />);
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("思考全文");
    expect(container.querySelector("button")?.textContent).toContain("▾ 思考 · 4 字");
  });

  it("点击摘要行切换展开/折叠", () => {
    const { container } = render(<ThinkingBlock text="abc" />);
    const btn = container.querySelector("button")!;
    click(btn);
    expect(container.querySelector("pre")?.textContent).toBe("abc");
    click(btn);
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("ToolRow", () => {
  it("running 态:呼吸点 animate-pulse + focus 色", () => {
    const { container } = render(
      <ToolRow toolName="bash" argsPreview="ls -la" status="running" />,
    );
    const dot = container.querySelector('[data-status="running"] > span');
    expect(dot?.className).toContain("animate-pulse");
    expect(dot?.className).toContain("bg-[var(--focus)]");
    // 行内含工具名与参数预览(mono)
    expect(container.textContent).toContain("bash");
    const args = container.querySelector(".font-mono");
    expect(args?.textContent).toBe("ls -la");
  });

  it("ok 态:✓ + 耗时,ok 色样式类", () => {
    const { container } = render(
      <ToolRow toolName="read" argsPreview="a.ts" status="ok" durationMs={120} />,
    );
    const st = container.querySelector('[data-status="ok"]');
    expect(st?.className).toContain("text-[var(--ok)]");
    expect(st?.textContent).toBe("✓ 120ms");
  });

  it("err 态默认折叠,点击展开 stderr 块", () => {
    const { container } = render(
      <ToolRow toolName="bash" argsPreview="exit 1" status="err" stderr="boom" />,
    );
    const st = container.querySelector('[data-status="err"]');
    expect(st?.className).toContain("text-[var(--err)]");
    expect(container.querySelector("pre")).toBeNull();
    click(st!);
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("boom");
    expect(pre?.className).toContain("font-mono");
    expect(pre?.className).toContain("bg-[var(--bg-2)]");
  });

  it("ok 态无展开入口,stderr 不渲染", () => {
    const { container } = render(
      <ToolRow toolName="read" status="ok" stderr="不该出现" />,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("MessageItem", () => {
  it("user 角色名「你」,assistant 角色名「pi」", () => {
    const a = render(
      <MessageItem role="user">
        <p>问</p>
      </MessageItem>,
    );
    expect(a.container.querySelector("header")?.textContent).toContain("你");
    const b = render(
      <MessageItem role="assistant">
        <p>答</p>
      </MessageItem>,
    );
    expect(b.container.querySelector("header")?.textContent).toContain("pi");
  });

  it("token 计数 mono 12px 显示在行头右侧", () => {
    const { container } = render(
      <MessageItem role="assistant" tokens={1024}>
        <p>答</p>
      </MessageItem>,
    );
    const tok = container.querySelector(".font-mono");
    expect(tok?.textContent).toBe("1024 tok");
    expect(tok?.className).toContain("text-[12px]");
  });

  it("无 tokens 时不渲染计数;user 气泡为 bg-2 + 16px 圆角", () => {
    const { container } = render(
      <MessageItem role="user">
        <p>问</p>
      </MessageItem>,
    );
    expect(container.querySelector(".font-mono")).toBeNull();
    const article = container.querySelector("article");
    expect(article?.className).toContain("justify-end");
    const bubble = article?.querySelector("div[class*='rounded-[16px]']");
    expect(bubble?.className).toContain("bg-[var(--bg-3)]");
  });
});
