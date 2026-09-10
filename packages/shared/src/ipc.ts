// IPC 契约:渲染进程 ↔ 主进程,通道名一次定死(pidesk: 前缀)
import type { RpcSessionState } from "./protocol";

// ---------- 常量 ----------

// (B) invoke 通道:渲染进程发起、主进程应答
export const INVOKE_CHANNELS = {
  SESSION_CREATE: "pidesk:session:create",
  SESSION_PROMPT: "pidesk:session:prompt",
  SESSION_ABORT: "pidesk:session:abort",
  SESSION_GET_STATE: "pidesk:session:getState",
  SESSION_SET_MODEL: "pidesk:session:setModel",
  SESSION_SET_THINKING_LEVEL: "pidesk:session:setThinkingLevel",
  SESSION_LIST_MODELS: "pidesk:session:listModels",
  SETTINGS_GET_MODEL_CONFIG: "pidesk:settings:getModelConfig",
  SETTINGS_SET_MODEL_CONFIG: "pidesk:settings:setModelConfig",
  WINDOW_GET_STATE: "pidesk:window:getState",
  WINDOW_MINIMIZE: "pidesk:window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "pidesk:window:toggleMaximize",
  WINDOW_CLOSE: "pidesk:window:close",
  CONFIG_GET: "pidesk:config:get",
  CONFIG_APP_SAVE: "pidesk:config:appSave",
  CONFIG_PROVIDER_UPSERT: "pidesk:config:providerUpsert",
  CONFIG_PROVIDER_REMOVE: "pidesk:config:providerRemove",
  CONFIG_DEFAULT_MODEL_SET: "pidesk:config:defaultModelSet",
} as const;

// (C) push 通道:主进程单向推送
export const PUSH_CHANNELS = {
  SESSION_EVENT: "pidesk:event",
  PROCESS_STATE: "pidesk:process",
} as const;

// ---------- 数据模型 ----------

// 模型信息(待 T8 对齐)
export interface ModelInfo {
  provider: string;
  modelId: string;
  name?: string;
  thinkingLevels?: string[];
}

// Provider 连接配置(M1 仅单连接)
export interface ProviderConfig {
  preset: "ollama" | "custom-openai";
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  saveKey: boolean;
}

// pi 进程生命周期状态
export type PideskProcessState =
  | "spawning"
  | "handshaking"
  | "ready"
  | "busy"
  | "stopping"
  | "crashed"
  | "stopped";

// ---------- config-center 数据模型(与 main/config-center 落盘结构一致) ----------

export type ProviderPreset = "ollama" | "custom-openai";

export type ProviderModel = { id: string; name?: string };

export type ProviderProfile = {
  id: string; // pi provider id,如 "ollama" / "custom-openai" / 自定义唯一 id
  name: string;
  preset: ProviderPreset;
  baseUrl: string;
  models: ProviderModel[];
  defaultModelId?: string;
  /** 是否把 key 持久化到 auth.json;false 时只回显 hasKey=true */
  saveKey: boolean;
  enabled: boolean;
};

export type AppPreferences = {
  proxy: { http?: string; https?: string };
  defaultModel?: { provider: string; modelId: string; thinkingLevel?: string };
};

export type ConfigSnapshot = {
  app: AppPreferences;
  providers: Array<ProviderProfile & { hasKey: boolean }>;
};

// ---------- (B) invoke:通道 → [请求, 响应] ----------

import type { JsonAgentSessionEvent, ExtensionUIRequest, ExtensionError } from "./protocol";

export interface InvokeMap {
  // 无入参:用 Record<string, never> 表达"空对象",替代会触发 lint 的 {}
  [INVOKE_CHANNELS.SESSION_CREATE]: [Record<string, never>, { sessionId: string }];
  [INVOKE_CHANNELS.SESSION_PROMPT]: [
    { sessionId: string; message: string },
    { ok: boolean },
  ];
  [INVOKE_CHANNELS.SESSION_ABORT]: [{ sessionId: string }, { ok: boolean }];
  [INVOKE_CHANNELS.SESSION_GET_STATE]: [{ sessionId: string }, RpcSessionState];
  [INVOKE_CHANNELS.SESSION_SET_MODEL]: [
    { sessionId: string; provider: string; modelId: string },
    { ok: boolean },
  ];
  [INVOKE_CHANNELS.SESSION_SET_THINKING_LEVEL]: [
    { sessionId: string; level: string },
    { ok: boolean },
  ];
  [INVOKE_CHANNELS.SESSION_LIST_MODELS]: [
    { sessionId: string },
    { models: ModelInfo[] },
  ];
  // 注:getModelConfig 返回前 apiKey 脱敏由主进程负责
  [INVOKE_CHANNELS.SETTINGS_GET_MODEL_CONFIG]: [unknown, ProviderConfig];
  [INVOKE_CHANNELS.SETTINGS_SET_MODEL_CONFIG]: [ProviderConfig, ProviderConfig];
  // ---- 窗口控制(无边框窗口的自定义标题栏)----
  [INVOKE_CHANNELS.WINDOW_GET_STATE]: [Record<string, never>, { maximized: boolean }];
  [INVOKE_CHANNELS.WINDOW_MINIMIZE]: [Record<string, never>, { maximized: boolean }];
  [INVOKE_CHANNELS.WINDOW_TOGGLE_MAXIMIZE]: [Record<string, never>, { maximized: boolean }];
  [INVOKE_CHANNELS.WINDOW_CLOSE]: [Record<string, never>, { maximized: boolean }];
  // ---- config-center(写操作返回最新快照;快照不含明文 apiKey)----
  [INVOKE_CHANNELS.CONFIG_GET]: [Record<string, never>, ConfigSnapshot];
  [INVOKE_CHANNELS.CONFIG_APP_SAVE]: [AppPreferences, ConfigSnapshot];
  [INVOKE_CHANNELS.CONFIG_PROVIDER_UPSERT]: [
    { profile: ProviderProfile; apiKey?: string },
    ConfigSnapshot,
  ];
  [INVOKE_CHANNELS.CONFIG_PROVIDER_REMOVE]: [{ id: string }, ConfigSnapshot];
  [INVOKE_CHANNELS.CONFIG_DEFAULT_MODEL_SET]: [
    { defaultModel?: AppPreferences["defaultModel"] },
    ConfigSnapshot,
  ];
}

// ---------- (C) push:主进程 → 渲染进程 ----------

export interface PushMap {
  [PUSH_CHANNELS.SESSION_EVENT]: {
    sessionId: string;
    event: JsonAgentSessionEvent | ExtensionUIRequest | ExtensionError;
  };
  [PUSH_CHANNELS.PROCESS_STATE]: {
    sessionId: string;
    state: PideskProcessState;
  };
}

/** push 载荷别名(渲染层订阅回调用) */
export type SessionEventPayload = PushMap[(typeof PUSH_CHANNELS)["SESSION_EVENT"]];
export type ProcessStatePayload = PushMap[(typeof PUSH_CHANNELS)["PROCESS_STATE"]];

/** push 消息联合(渲染进程订阅用) */
export type PushMessage = {
  [C in keyof PushMap]: { channel: C; payload: PushMap[C] };
}[keyof PushMap];

// ---------- preload 白名单桥类型面 ----------

/** push 事件订阅的取消函数 */
export type EventUnsubscribe = () => void;

/** invoke 通道的请求/响应便捷别名(保证桥签名与 InvokeMap 契约一致) */
type InvokeReq<C extends keyof InvokeMap> = InvokeMap[C][0];
type InvokeRes<C extends keyof InvokeMap> = InvokeMap[C][1];

/** 渲染进程唯一可见 API(window.pidesk):preload 实现须 satisfies 此类型锁死 */
export interface PideskBridge {
  sessionCreate(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_CREATE"]>>;
  sessionPrompt(
    sessionId: string,
    message: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_PROMPT"]>>;
  sessionAbort(sessionId: string): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_ABORT"]>>;
  sessionGetState(
    sessionId: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_GET_STATE"]>>;
  sessionSetModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_SET_MODEL"]>>;
  sessionSetThinkingLevel(
    sessionId: string,
    level: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_SET_THINKING_LEVEL"]>>;
  sessionListModels(
    sessionId: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SESSION_LIST_MODELS"]>>;
  // 注:apiKey 脱敏由 main 返回前完成,preload 仅透传类型
  settingsGetModelConfig(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SETTINGS_GET_MODEL_CONFIG"]>>;
  settingsSetModelConfig(
    config: InvokeReq<(typeof INVOKE_CHANNELS)["SETTINGS_SET_MODEL_CONFIG"]>,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["SETTINGS_SET_MODEL_CONFIG"]>>;
  // ---- 窗口控制 ----
  windowGetState(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["WINDOW_GET_STATE"]>>;
  windowMinimize(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["WINDOW_MINIMIZE"]>>;
  windowToggleMaximize(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["WINDOW_TOGGLE_MAXIMIZE"]>>;
  windowClose(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["WINDOW_CLOSE"]>>;
  // ---- config-center ----
  configGet(): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["CONFIG_GET"]>>;
  configAppSave(
    app: InvokeReq<(typeof INVOKE_CHANNELS)["CONFIG_APP_SAVE"]>,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["CONFIG_APP_SAVE"]>>;
  configProviderUpsert(
    profile: InvokeReq<(typeof INVOKE_CHANNELS)["CONFIG_PROVIDER_UPSERT"]>["profile"],
    apiKey?: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["CONFIG_PROVIDER_UPSERT"]>>;
  configProviderRemove(
    id: string,
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["CONFIG_PROVIDER_REMOVE"]>>;
  configDefaultModelSet(
    defaultModel?: InvokeReq<(typeof INVOKE_CHANNELS)["CONFIG_DEFAULT_MODEL_SET"]>["defaultModel"],
  ): Promise<InvokeRes<(typeof INVOKE_CHANNELS)["CONFIG_DEFAULT_MODEL_SET"]>>;
  // ---- push 事件订阅:收主进程定向推送,返回取消函数 ----
  onSessionEvent(
    cb: (payload: PushMap[(typeof PUSH_CHANNELS)["SESSION_EVENT"]]) => void,
  ): EventUnsubscribe;
  onProcessState(
    cb: (payload: PushMap[(typeof PUSH_CHANNELS)["PROCESS_STATE"]]) => void,
  ): EventUnsubscribe;
}
