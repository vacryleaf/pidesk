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

// ---------- (B) invoke:通道 → [请求, 响应] ----------

import type { JsonAgentSessionEvent, ExtensionUIRequest, ExtensionError } from "./protocol";

export interface InvokeMap {
  [INVOKE_CHANNELS.SESSION_CREATE]: [{}, { sessionId: string }];
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

/** push 消息联合(渲染进程订阅用) */
export type PushMessage = {
  [C in keyof PushMap]: { channel: C; payload: PushMap[C] };
}[keyof PushMap];
