/**
 * Composer 测试(T9c):
 * Enter 发送并清空 / Shift+Enter 不发送仅换行 / sending 态按钮为中止且点击调 onAbort /
 * sending 态 Enter 禁发 / 队列计数显示与隐藏 / 空文本 Enter 不发送。
 * 环境为 jsdom,沿用 T9a/T9b 风格:不引 testing-library,直接用 react-dom/client。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { Composer } from "./composer";

// React act 环境标记(jsdom 下必设,否则 act 告警)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 极简渲染助手:挂到 document.body,返回容器与 root(供 rerender) */
function render(ui: ReactElement): { container: HTMLElement; rerender: (next: ReactElement) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
  };
}

/** 模拟输入:走 value 原型 setter + input 事件(绕过 React value tracker) */
function type(el: HTMLTextAreaElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 模拟按下 Enter(shift=true 表示 Shift+Enter);返回事件以断言 defaultPrevented */
function pressEnter(el: HTMLTextAreaElement, shift = false): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Composer", () => {
  it("Enter 发送:调 onSend 并清空输入", () => {
    const onSend = vi.fn();
    const { container } = render(<Composer sending={false} onSend={onSend} onAbort={vi.fn()} />);
    const ta = container.querySelector("textarea")!;
    type(ta, "你好");
    const ev = pressEnter(ta);
    expect(ev.defaultPrevented).toBe(true); // 阻止了默认换行
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("你好");
    expect(ta.value).toBe(""); // 发送后清空
  });

  it("Shift+Enter 不发送仅换行:不走 onSend,不阻止默认行为", () => {
    const onSend = vi.fn();
    const { container } = render(<Composer sending={false} onSend={onSend} onAbort={vi.fn()} />);
    const ta = container.querySelector("textarea")!;
    type(ta, "第一行");
    const ev = pressEnter(ta, true);
    expect(onSend).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false); // 换行交由浏览器默认行为
  });

  it("sending 态:按钮为中止(⏹ Square)且点击调 onAbort,点击不触发 onSend", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    const { container } = render(<Composer sending onSend={onSend} onAbort={onAbort} />);
    const btn = container.querySelector('button[aria-label="中止"]')!;
    // ⏹ 图标为 Square(lucide-square)
    expect(btn.querySelector("svg.lucide-square")).not.toBeNull();
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sending 态 Enter 禁发", () => {
    const onSend = vi.fn();
    const { container } = render(<Composer sending onSend={onSend} onAbort={vi.fn()} />);
    const ta = container.querySelector("textarea")!;
    type(ta, "发送中还想发");
    pressEnter(ta);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("队列计数:任一 >0 显示,无/全 0 隐藏", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    const { container, rerender } = render(
      <Composer sending={false} onSend={onSend} onAbort={onAbort} />,
    );
    expect(container.textContent).not.toContain("队列");
    // 全 0 同样隐藏
    rerender(
      <Composer sending={false} queueCounts={{ steering: 0, followUp: 0 }} onSend={onSend} onAbort={onAbort} />,
    );
    expect(container.textContent).not.toContain("队列");
    // steering >0 显示计数
    rerender(
      <Composer sending={false} queueCounts={{ steering: 1, followUp: 0 }} onSend={onSend} onAbort={onAbort} />,
    );
    expect(container.textContent).toContain("steering 1");
    // 两者同时 >0 均展示
    rerender(
      <Composer sending={false} queueCounts={{ steering: 2, followUp: 3 }} onSend={onSend} onAbort={onAbort} />,
    );
    expect(container.textContent).toContain("steering 2");
    expect(container.textContent).toContain("followUp 3");
  });

  it("空文本 Enter 不发送", () => {
    const onSend = vi.fn();
    const { container } = render(<Composer sending={false} onSend={onSend} onAbort={vi.fn()} />);
    const ta = container.querySelector("textarea")!;
    pressEnter(ta);
    expect(onSend).not.toHaveBeenCalled();
  });
});
