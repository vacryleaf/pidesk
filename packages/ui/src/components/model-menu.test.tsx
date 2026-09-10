/**
 * ModelMenu 测试(T11c):
 * - 触发器显示当前 `provider/model:thinking`(模型 id 走 mono)
 * - 弹层开合(点击触发器开;再点/点击外部/Escape 关)
 * - 打开时经 listModels 拉取;空列表 → 空态文案
 * - 选模型回调 onSetModel,并即时刷新档位子列表
 * - 选档位回调 onSetThinkingLevel(仅呈现可用档位,顺序固定)
 * 环境为 jsdom,沿用 T11b 风格:不引 testing-library,直接用 react-dom/client。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { ModelMenu, type ModelInfo, type ModelMenuProps } from "./model-menu";

// React act 环境标记(jsdom 下必设,否则 act 告警)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 已挂根记录:afterEach 统一卸载 */
const roots: Array<ReturnType<typeof createRoot>> = [];

/** 极简渲染助手:挂到 document.body,返回容器 */
function render(ui: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(ui);
  });
  return container;
}

/** 等待微任务队列落地(listModels promise) */
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

/** 模拟点击(bubbles,走 React 合成事件) */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  roots.splice(0).forEach((root) => root.unmount());
  document.body.innerHTML = "";
});

/** 样例模型:两 provider,部分模型带档位、部分不带 */
const sampleModels: ModelInfo[] = [
  {
    provider: "ollama",
    modelId: "qwen3:8b",
    name: "Qwen3 8B",
    thinkingLevels: ["off", "low", "medium", "high"],
  },
  { provider: "ollama", modelId: "llama3:8b", name: "Llama 3" },
  { provider: "openai", modelId: "gpt-x", name: "GPT-X", thinkingLevels: ["minimal", "high"] },
];

/** 构造 props:onSetModel / onSetThinkingLevel 用 vi.fn,listModels 可按需覆写 */
function makeProps(overrides: Partial<ModelMenuProps> = {}): ModelMenuProps {
  return {
    provider: "ollama",
    modelId: "qwen3:8b",
    thinkingLevel: "medium",
    onSetModel: vi.fn(),
    onSetThinkingLevel: vi.fn(),
    listModels: vi.fn().mockResolvedValue(sampleModels),
    ...overrides,
  };
}

describe("ModelMenu", () => {
  it("触发器显示当前 provider/model:thinking(模型 id 走 mono)", () => {
    const props = makeProps();
    const c = render(<ModelMenu {...props} />);
    const trigger = c.querySelector('[data-testid="model-menu-trigger"]')!;
    expect(trigger.textContent).toBe("ollama/qwen3:8b:medium");
    // 模型 id 所在 span 用 mono 字体
    const idSpan = Array.from(trigger.querySelectorAll("span")).find(
      (s) => s.textContent === "qwen3:8b",
    )!;
    expect(idSpan.className).toContain("font-mono");
    // 未打开时无弹层,也不拉取
    expect(c.querySelector('[data-testid="model-menu-popover"]')).toBeNull();
    expect(props.listModels).not.toHaveBeenCalled();
  });

  it("弹层开合:点击触发器打开并拉取,再点关闭;Escape 关闭", async () => {
    const props = makeProps();
    const c = render(<ModelMenu {...props} />);
    const trigger = c.querySelector('[data-testid="model-menu-trigger"]')!;
    click(trigger);
    await flush();
    expect(c.querySelector('[data-testid="model-menu-popover"]')).not.toBeNull();
    expect(props.listModels).toHaveBeenCalledTimes(1);
    // 再点触发器关闭
    click(trigger);
    expect(c.querySelector('[data-testid="model-menu-popover"]')).toBeNull();
    // 重开后 Escape 关闭
    click(trigger);
    await flush();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(c.querySelector('[data-testid="model-menu-popover"]')).toBeNull();
  });

  it("选模型:回调 onSetModel(provider,modelId),触发器即时更新且档位刷新", async () => {
    const props = makeProps();
    const c = render(<ModelMenu {...props} />);
    click(c.querySelector('[data-testid="model-menu-trigger"]')!);
    await flush();
    // 当前项标 focus 窄条(aria-checked/active)
    const items = Array.from(c.querySelectorAll('[data-testid="model-menu-item"]'));
    const current = items.find((el) => el.textContent?.includes("qwen3:8b"))!;
    expect(current.getAttribute("data-active")).toBe("true");
    // 切换到 llama3:8b(无 thinkingLevels → 档位子列表消失)
    const target = items.find((el) => el.textContent?.includes("llama3:8b"))!;
    click(target);
    expect(props.onSetModel).toHaveBeenCalledTimes(1);
    expect(props.onSetModel).toHaveBeenCalledWith("ollama", "llama3:8b");
    expect(c.querySelector('[data-testid="model-menu-trigger"]')!.textContent).toBe(
      "ollama/llama3:8b:medium",
    );
    expect(c.querySelector('[data-testid="model-menu-levels"]')).toBeNull();
  });

  it("选档位:仅列出可用档位且顺序固定,点击回调 onSetThinkingLevel 并关闭弹层", async () => {
    const props = makeProps();
    const c = render(<ModelMenu {...props} />);
    click(c.querySelector('[data-testid="model-menu-trigger"]')!);
    await flush();
    const levels = Array.from(c.querySelectorAll('[data-testid="thinking-item"]')).map(
      (el) => el.textContent,
    );
    // qwen3:8b 声明 off/low/medium/high → 按固定顺序渲染
    expect(levels).toEqual(["off", "low", "medium", "high"]);
    // 当前档位 medium 标 focus
    const current = Array.from(c.querySelectorAll('[data-testid="thinking-item"]')).find(
      (el) => el.textContent === "medium",
    )!;
    expect(current.getAttribute("data-active")).toBe("true");
    // 选 high → 回调并关闭
    const high = Array.from(c.querySelectorAll('[data-testid="thinking-item"]')).find(
      (el) => el.textContent === "high",
    )!;
    click(high);
    expect(props.onSetThinkingLevel).toHaveBeenCalledTimes(1);
    expect(props.onSetThinkingLevel).toHaveBeenCalledWith("high");
    expect(c.querySelector('[data-testid="model-menu-popover"]')).toBeNull();
  });

  it("空态:列表为空显示「无可用模型,请在配置中设置连接」", async () => {
    const props = makeProps({ listModels: vi.fn().mockResolvedValue([]) });
    const c = render(<ModelMenu {...props} />);
    click(c.querySelector('[data-testid="model-menu-trigger"]')!);
    await flush();
    expect(c.querySelector('[data-testid="model-menu-empty"]')).not.toBeNull();
    expect(c.textContent).toContain("无可用模型,请在配置中设置连接");
    expect(c.querySelector('[data-testid="model-menu-item"]')).toBeNull();
  });
});
