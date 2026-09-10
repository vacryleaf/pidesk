/**
 * SettingsDialog(T11b)—— 模型连接设置弹层(m1-design §6 定版 + ui-prototype §5.2 凭据行)。
 * - 受控 open:Escape / 遮罩点击 / 保存成功后经 onClose 关闭。
 * - 连接类型二选一:预置 Ollama(baseUrl 固定只读)/ 自定义 OpenAI 兼容(baseUrl 可编辑)。
 * - 打开时经桥拉取配置回填;保存经桥落盘,成功 toast「已保存,重启会话后生效」+ 关窗,失败 toast 错误。
 * - Dialog 用受控 div 遮罩(不引 radix);视觉走令牌:hairline 边 + bg-0/1 层积,无阴影无渐变。
 * - ToastHost 渲染在弹层条件分支之外,关窗后 toast 仍能存活到 3s 自散。
 */
import { useEffect, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { ToastHost, useToasts } from "./toast";

/** Ollama 预置 baseUrl(选中该类型时固定只读展示) */
const OLLAMA_BASE_URL = "http://localhost:11434/v1";
/** 已保存 apiKey 的脱敏回显值(对齐 main 侧 pi-host-manager.redactConfig) */
const REDACTED_KEY = "********";

/** Provider 连接配置(结构对齐 shared/ipc.ts 的 ProviderConfig;ui 包不依赖 shared,按最小形状声明) */
export type ProviderConfigForm = {
  preset: "ollama" | "custom-openai";
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  saveKey: boolean;
};

/** 设置动作桥:与 window.pidesk 结构兼容子集(仅 settings 两个 invoke) */
export type SettingsBridge = {
  settingsGetModelConfig(): Promise<ProviderConfigForm>;
  settingsSetModelConfig(config: ProviderConfigForm): Promise<ProviderConfigForm>;
};

/** 取桥:显式入参优先,否则读 window.pidesk(非 Electron / 测试环境返回 undefined) */
function resolveBridge(explicit?: SettingsBridge): SettingsBridge | undefined {
  if (explicit) return explicit;
  const candidate = (globalThis as { pidesk?: Partial<SettingsBridge> }).pidesk;
  if (
    candidate &&
    typeof candidate.settingsGetModelConfig === "function" &&
    typeof candidate.settingsSetModelConfig === "function"
  ) {
    return candidate as SettingsBridge;
  }
  return undefined;
}

/** 错误转文案:Error 取 message,其余 String 化(Electron invoke reject 默认是 Error) */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type SettingsDialogProps = {
  /** 是否打开(受控) */
  open: boolean;
  /** 关闭回调(Escape / 遮罩点击 / 保存成功后由父层置 false) */
  onClose(): void;
  /** 桥注入(测试用);缺省读 window.pidesk 子集 */
  bridge?: SettingsBridge;
};

/**
 * SettingsDialog —— 模型连接单连接表单。
 * apiKey 留空或仍为脱敏回显值时不下发该字段(「留空不修改」语义,
 * main 侧 saveProviderConfig 仅在 saveKey && apiKey 非空时才写 auth.json)。
 */
export function SettingsDialog({ open, onClose, bridge }: SettingsDialogProps) {
  const { toasts, push } = useToasts();
  const [preset, setPreset] = useState<"ollama" | "custom-openai">("ollama");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [saveKey, setSaveKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  // 是否已有已保存凭据(getModelConfig 回显 apiKey 非空),控制 placeholder 文案
  const [hasSavedKey, setHasSavedKey] = useState(false);

  // 打开时:复位表单 → 拉取配置回填;拉取失败仅 toast 不阻塞表单
  useEffect(() => {
    if (!open) return;
    setPreset("ollama");
    setBaseUrl("");
    setApiKey("");
    setModelId("");
    setSaveKey(false);
    setShowKey(false);
    setSaving(false);
    setHasSavedKey(false);
    const b = resolveBridge(bridge);
    if (!b) return;
    let cancelled = false;
    void (async () => {
      try {
        const config = await b.settingsGetModelConfig();
        if (cancelled) return;
        setPreset(config.preset);
        setBaseUrl(config.baseUrl);
        setApiKey(config.apiKey ?? "");
        setModelId(config.modelId);
        setSaveKey(config.saveKey);
        setHasSavedKey(Boolean(config.apiKey));
      } catch (err) {
        if (!cancelled) push(`读取配置失败:${errText(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bridge, push]);

  // 打开期间监听 Escape 关闭(挂 document,避免依赖输入框聚焦)
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** 保存:组装 ProviderConfig(ollama 强制预置 baseUrl;空/脱敏 key 不下发)→ 调桥 → toast + 关窗 */
  const handleSave = () => {
    const b = resolveBridge(bridge);
    if (!b || saving) return;
    setSaving(true);
    const key = apiKey.trim();
    const config: ProviderConfigForm = {
      preset,
      baseUrl: preset === "ollama" ? OLLAMA_BASE_URL : baseUrl.trim(),
      ...(key && key !== REDACTED_KEY ? { apiKey: key } : {}),
      modelId: modelId.trim(),
      saveKey,
    };
    void b
      .settingsSetModelConfig(config)
      .then(() => {
        push("已保存,重启会话后生效");
        onClose();
      })
      .catch((err: unknown) => {
        push(`保存失败:${errText(err)}`);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const isOllama = preset === "ollama";

  return (
    <>
      {/* toast 宿主在条件分支外:关窗后提示仍存活至 3s 自散 */}
      <ToastHost toasts={toasts} />
      {open && (
        <div
          data-testid="settings-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)]"
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="模型连接"
            data-testid="settings-dialog"
            className="w-[520px] max-w-[92vw] rounded-[20px] bg-[var(--bg-2)] p-6 shadow-[var(--shadow-lg)] ring-1 ring-[var(--ring)]"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[18px] font-medium leading-[24px] text-[var(--text-0)]">模型连接</h2>
              <button
                type="button"
                aria-label="关闭"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text-1)]"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            {/* 连接类型二选一 */}
            <div className="mb-3 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-0)]">
                <input
                  type="radio"
                  name="settings-preset"
                  data-testid="settings-preset-ollama"
                  checked={isOllama}
                  onChange={() => setPreset("ollama")}
                />
                预置 Ollama
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-0)]">
                <input
                  type="radio"
                  name="settings-preset"
                  data-testid="settings-preset-custom"
                  checked={!isOllama}
                  onChange={() => setPreset("custom-openai")}
                />
                自定义 OpenAI 兼容
              </label>
            </div>

            {/* baseUrl:ollama 固定只读,custom 可编辑 */}
            <label className="mb-1 block text-[13px] text-[var(--text-1)]">Base URL</label>
            <input
              data-testid="settings-baseurl"
              type="text"
              value={isOllama ? OLLAMA_BASE_URL : baseUrl}
              readOnly={isOllama}
              placeholder="https://your-gateway/v1"
              onChange={(ev) => setBaseUrl(ev.target.value)}
              className={
                "mb-3 h-8 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-3)] px-3 text-[14px] outline-none focus:ring-1 focus:ring-[var(--focus)] " +
                (isOllama ? "text-[var(--text-1)]" : "text-[var(--text-0)]")
              }
            />

            {/* apiKey:password 型 + 显隐切换;已保存时提示留空不修改 */}
            <label className="mb-1 block text-[13px] text-[var(--text-1)]">API Key</label>
            <div className="relative mb-3">
              <input
                data-testid="settings-apikey"
                type={showKey ? "text" : "password"}
                value={apiKey}
                placeholder={hasSavedKey ? "已保存,留空不修改" : ""}
                onChange={(ev) => setApiKey(ev.target.value)}
                className="h-8 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-3)] px-3 pr-9 text-[14px] text-[var(--text-0)] outline-none focus:ring-1 focus:ring-[var(--focus)]"
              />
              <button
                type="button"
                data-testid="settings-apikey-toggle"
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[var(--text-1)]"
              >
                {showKey ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
              </button>
            </div>

            {/* 模型 ID */}
            <label className="mb-1 block text-[13px] text-[var(--text-1)]">模型 ID</label>
            <input
              data-testid="settings-modelid"
              type="text"
              value={modelId}
              onChange={(ev) => setModelId(ev.target.value)}
              className="mb-3 h-8 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-3)] px-3 text-[14px] text-[var(--text-0)] outline-none focus:ring-1 focus:ring-[var(--focus)]"
            />

            {/* 保存凭据:默认不勾 */}
            <label className="mb-4 flex items-center gap-1.5 text-[13px] text-[var(--text-0)]">
              <input
                type="checkbox"
                data-testid="settings-savekey"
                checked={saveKey}
                onChange={(ev) => setSaveKey(ev.target.checked)}
              />
              保存凭据
              <span className="text-[12px] text-[var(--text-1)]">勾选后写入本机 auth.json</span>
            </label>

            {/* 底部动作:取消 / 保存 */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="settings-cancel"
                onClick={onClose}
                className="h-8 rounded-[8px] bg-[var(--bg-3)] px-3 text-[14px] text-[var(--text-0)]"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="settings-save"
                disabled={saving}
                onClick={handleSave}
                className="h-8 rounded-[8px] bg-[var(--text-0)] px-3 text-[14px] text-[var(--bg-1)] disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
