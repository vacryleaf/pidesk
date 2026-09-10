/**
 * SettingsDialog 测试(T11b)+ NavShell 配置项启用:
 * - 渲染与回填(getModelConfig → 表单)/ open=false 不渲染
 * - 二选一切换:ollama 时 baseUrl 只读且为预置值,custom 时可编辑
 * - 密码显隐切换
 * - 保存调用:ollama 强制预置 baseUrl / 留空或脱敏 key 不下发(留空不修改)/ 成功 toast + 关窗
 * - 保存失败:错误 toast,弹窗不关
 * - Escape / 遮罩点击关闭;面板内点击不关
 * - NavShell:传 onOpenSettings 则配置项可点击并回调,未传保持禁用
 * 环境为 jsdom,沿用 T9a 风格:不引 testing-library,直接用 react-dom/client。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { SettingsDialog, type ProviderConfigForm, type SettingsBridge } from "./settings-dialog";
import { NavShell } from "./nav-shell";

// React act 环境标记(jsdom 下必设,否则 act 告警)
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 已挂根记录:afterEach 统一卸载,顺带清掉 toast 在途计时器 */
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

/** 等待微任务队列落地(effect 内异步回填 / 保存 promise) */
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

/** 模拟输入:走 value 原型 setter + input 事件(绕过 React value tracker) */
function type(el: HTMLInputElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 模拟点击(bubbles,走 React 合成事件) */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 用最近一次 render 的根重渲染(模拟父层受控 open 翻转) */
function rerenderLast(ui: ReactElement): void {
  const root = roots[roots.length - 1]!;
  act(() => {
    root.render(ui);
  });
}

afterEach(() => {
  roots.splice(0).forEach((root) => root.unmount());
  document.body.innerHTML = "";
});

/** 回填样例:已保存凭据的脱敏回显(对齐 main 侧 redactConfig) */
const savedConfig: ProviderConfigForm = {
  preset: "custom-openai",
  baseUrl: "https://gw.example/v1",
  apiKey: "********",
  modelId: "gpt-x",
  saveKey: true,
};

/** 构造桥:getModelConfig 回样例,setModelConfig 可覆写 */
function makeBridge(setModelConfig?: SettingsBridge["settingsSetModelConfig"]): SettingsBridge {
  return {
    settingsGetModelConfig: vi.fn().mockResolvedValue(savedConfig),
    settingsSetModelConfig: setModelConfig ?? vi.fn().mockResolvedValue(savedConfig),
  };
}

describe("SettingsDialog", () => {
  it("打开渲染并回填:字段值 / 只读态 / placeholder / checkbox", async () => {
    const bridge = makeBridge();
    const c = render(<SettingsDialog open onClose={vi.fn()} bridge={bridge} />);
    await flush();
    expect(bridge.settingsGetModelConfig).toHaveBeenCalledTimes(1);
    const baseUrl = c.querySelector('[data-testid="settings-baseurl"]') as HTMLInputElement;
    expect(baseUrl.value).toBe("https://gw.example/v1");
    expect(baseUrl.readOnly).toBe(false); // custom preset 可编辑
    expect((c.querySelector('[data-testid="settings-modelid"]') as HTMLInputElement).value).toBe(
      "gpt-x",
    );
    expect((c.querySelector('[data-testid="settings-savekey"]') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (c.querySelector('[data-testid="settings-preset-custom"]') as HTMLInputElement).checked,
    ).toBe(true);
    const key = c.querySelector('[data-testid="settings-apikey"]') as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.placeholder).toContain("已保存,留空不修改");
  });

  it("open=false 不渲染弹层", async () => {
    const c = render(<SettingsDialog open={false} onClose={vi.fn()} bridge={makeBridge()} />);
    await flush();
    expect(c.querySelector('[data-testid="settings-dialog"]')).toBeNull();
  });

  it("二选一切换:ollama 时 baseUrl 只读且固定,custom 时可编辑", async () => {
    const c = render(<SettingsDialog open onClose={vi.fn()} bridge={makeBridge()} />);
    await flush();
    click(c.querySelector('[data-testid="settings-preset-ollama"]')!);
    const baseUrl = c.querySelector('[data-testid="settings-baseurl"]') as HTMLInputElement;
    expect(baseUrl.readOnly).toBe(true);
    expect(baseUrl.value).toBe("http://localhost:11434/v1");
    click(c.querySelector('[data-testid="settings-preset-custom"]')!);
    expect(baseUrl.readOnly).toBe(false);
  });

  it("密码显隐:默认 password,点切换变 text,再点还原", async () => {
    const c = render(<SettingsDialog open onClose={vi.fn()} bridge={makeBridge()} />);
    await flush();
    const toggle = c.querySelector('[data-testid="settings-apikey-toggle"]')!;
    const readType = () =>
      (c.querySelector('[data-testid="settings-apikey"]') as HTMLInputElement).type;
    expect(readType()).toBe("password");
    click(toggle);
    expect(readType()).toBe("text");
    click(toggle);
    expect(readType()).toBe("password");
  });

  it("保存:ollama 强制预置 baseUrl,留空 key 不下发;成功 toast + 关窗", async () => {
    const bridge = makeBridge();
    const onClose = vi.fn();
    const c = render(<SettingsDialog open onClose={onClose} bridge={bridge} />);
    await flush();
    // 切到 ollama,改模型 id,清空 apiKey(模拟「留空不修改」)
    click(c.querySelector('[data-testid="settings-preset-ollama"]')!);
    type(c.querySelector('[data-testid="settings-modelid"]') as HTMLInputElement, "qwen3:8b");
    type(c.querySelector('[data-testid="settings-apikey"]') as HTMLInputElement, "");
    click(c.querySelector('[data-testid="settings-save"]')!);
    await flush();
    expect(bridge.settingsSetModelConfig).toHaveBeenCalledTimes(1);
    expect(bridge.settingsSetModelConfig).toHaveBeenCalledWith({
      preset: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      saveKey: true,
    });
    expect(c.textContent).toContain("已保存,重启会话后生效");
    expect(onClose).toHaveBeenCalledTimes(1);
    // 受控关闭:父层响应 onClose 置 open=false → 弹层移除,toast(条件分支外)仍存活
    rerenderLast(<SettingsDialog open={false} onClose={onClose} bridge={bridge} />);
    expect(c.querySelector('[data-testid="settings-dialog"]')).toBeNull();
    expect(c.textContent).toContain("已保存,重启会话后生效");
  });

  it("保存失败:错误 toast,弹窗保持打开", async () => {
    const bridge = makeBridge(vi.fn().mockRejectedValue(new Error("磁盘只读")));
    const onClose = vi.fn();
    const c = render(<SettingsDialog open onClose={onClose} bridge={bridge} />);
    await flush();
    click(c.querySelector('[data-testid="settings-save"]')!);
    await flush();
    expect(c.textContent).toContain("保存失败:磁盘只读");
    expect(onClose).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="settings-dialog"]')).not.toBeNull();
  });

  it("Escape 关闭", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} bridge={makeBridge()} />);
    await flush();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩点击关闭;面板内点击不关(stopPropagation)", async () => {
    const onClose = vi.fn();
    const c = render(<SettingsDialog open onClose={onClose} bridge={makeBridge()} />);
    await flush();
    click(c.querySelector('[data-testid="settings-dialog"]')!);
    expect(onClose).not.toHaveBeenCalled();
    click(c.querySelector('[data-testid="settings-overlay"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NavShell 配置项(T11b)", () => {
  /** 从导航栏取「配置」按钮 */
  function settingsButton(c: HTMLElement): HTMLButtonElement {
    const found = Array.from(c.querySelectorAll("nav button")).find(
      (b) => b.textContent === "配置",
    );
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }

  it("传入 onOpenSettings:配置项可点击并回调", () => {
    const onOpenSettings = vi.fn();
    const c = render(
      <NavShell onOpenSettings={onOpenSettings}>
        <div />
      </NavShell>,
    );
    const btn = settingsButton(c);
    expect(btn.disabled).toBe(false);
    click(btn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("未传 onOpenSettings:配置项保持禁用", () => {
    const c = render(
      <NavShell>
        <div />
      </NavShell>,
    );
    expect(settingsButton(c).disabled).toBe(true);
  });
});
