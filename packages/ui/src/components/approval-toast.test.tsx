/**
 * ApprovalBar / Toast 渲染测试(T10c)。
 * 覆盖:审批条摘要与批准/拒绝回调;ToastHost 空态/多条堆叠;
 * useToasts push 入队 + 3s 自散(假计时器驱动)。
 * 环境为 jsdom,不引 testing-library,直接用 react-dom/client(同 components.test.tsx)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { ApprovalBar } from "./approval-bar";
import { ToastHost, useToasts } from "./toast";

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

describe("ApprovalBar", () => {
  it("渲染风险摘要与批准/拒绝两按钮", () => {
    const { container } = render(
      <ApprovalBar summary="允许执行 bash: rm -rf build" onApprove={() => {}} onReject={() => {}} />,
    );
    expect(container.querySelector('[data-testid="approval-bar"]')).not.toBeNull();
    expect(container.textContent).toContain("允许执行 bash: rm -rf build");
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["批准", "拒绝"]);
    // 批准=反色中性主按钮
    expect(buttons[0]?.className).toContain("bg-[var(--text-0)]");
  });

  it("点击批准/拒绝分别触发对应回调", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <ApprovalBar summary="risk" onApprove={onApprove} onReject={onReject} />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    click(buttons[0]!);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    click(buttons[1]!);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

describe("ToastHost", () => {
  it("空列表不渲染容器", () => {
    const { container } = render(<ToastHost toasts={[]} />);
    expect(container.querySelector('[data-testid="toast-host"]')).toBeNull();
  });

  it("多条堆叠并按序渲染文案", () => {
    const { container } = render(
      <ToastHost
        toasts={[
          { id: "a", text: "已保存" },
          { id: "b", text: "已复制" },
        ]}
      />,
    );
    const items = Array.from(container.querySelectorAll('[data-testid="toast"]'));
    expect(items.map((el) => el.textContent)).toEqual(["已保存", "已复制"]);
    // 令牌:bg-2 底 + hairline 边 + 13px 正文
    expect(items[0]?.className).toContain("bg-[var(--bg-2)]");
    expect(items[0]?.className).toContain("border-[var(--hairline)]");
    expect(items[0]?.className).toContain("text-[13px]");
  });
});

/** useToasts 测试挂具:按钮 push 一条,ToastHost 呈现当前列表 */
function ToastHarness() {
  const { toasts, push } = useToasts();
  return (
    <div>
      <button type="button" onClick={() => push("提示文案")}>
        推
      </button>
      <ToastHost toasts={toasts} />
    </div>
  );
}

describe("useToasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("push 后出现,3s 后自动移除", () => {
    const { container } = render(<ToastHarness />);
    const button = container.querySelector("button")!;
    click(button);
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    expect(container.textContent).toContain("提示文案");

    // 未到 3s 仍在
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);

    // 到 3s 自散
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(0);
  });

  it("多次 push 各自独立计时,多条堆叠", () => {
    const { container } = render(<ToastHarness />);
    const button = container.querySelector("button")!;
    click(button);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    click(button);
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(2);

    // 首个到期只移除一条
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(0);
  });
});
