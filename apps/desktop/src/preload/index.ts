// preload 桥接层:类型安全白名单,渲染进程仅能调用此处暴露的方法
// 安全约束:禁止透传 ipcRenderer 或任何 Node API 到渲染进程;
// 每个方法只绑定契约中的固定通道,载荷形状由 PideskBridge satisfies 锁死
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  INVOKE_CHANNELS,
  PUSH_CHANNELS,
  type AppPreferences,
  type EventUnsubscribe,
  type PideskBridge,
  type ProcessStatePayload,
  type ProviderConfig,
  type ProviderProfile,
  type PushMap,
  type SessionEventPayload,
} from "@pidesk/shared/ipc";

// push 事件订阅:收主进程定向推送,返回取消函数
function subscribe<C extends keyof PushMap>(
  channel: C,
  cb: (payload: PushMap[C]) => void,
): EventUnsubscribe {
  const listener = (_event: IpcRendererEvent, payload: PushMap[C]): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge = {
  // ---- 会话生命周期 ----
  sessionCreate: () => ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_CREATE, {}),
  // ---- 会话命令路由 ----
  // 注:箭头参数显式标注(satisfies 不向无标注参数流类型),签名仍由 satisfies 校验
  sessionPrompt: (sessionId: string, message: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_PROMPT, { sessionId, message }),
  sessionAbort: (sessionId: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_ABORT, { sessionId }),
  sessionGetState: (sessionId: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_GET_STATE, { sessionId }),
  sessionSetModel: (sessionId: string, provider: string, modelId: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_SET_MODEL, { sessionId, provider, modelId }),
  sessionSetThinkingLevel: (sessionId: string, level: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_SET_THINKING_LEVEL, { sessionId, level }),
  sessionListModels: (sessionId: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SESSION_LIST_MODELS, { sessionId }),
  // ---- 模型连接配置(apiKey 脱敏由 main 返回前完成,preload 不处理)----
  settingsGetModelConfig: () =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SETTINGS_GET_MODEL_CONFIG, {}),
  settingsSetModelConfig: (config: ProviderConfig) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.SETTINGS_SET_MODEL_CONFIG, config),
  // ---- 窗口控制(无边框窗口的自定义标题栏)----
  windowGetState: () => ipcRenderer.invoke(INVOKE_CHANNELS.WINDOW_GET_STATE, {}),
  windowMinimize: () => ipcRenderer.invoke(INVOKE_CHANNELS.WINDOW_MINIMIZE, {}),
  windowToggleMaximize: () => ipcRenderer.invoke(INVOKE_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, {}),
  windowClose: () => ipcRenderer.invoke(INVOKE_CHANNELS.WINDOW_CLOSE, {}),
  // ---- config-center(写操作返回最新 ConfigSnapshot;preload 仅透传)----
  configGet: () => ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_GET, {}),
  configAppSave: (app: AppPreferences) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_APP_SAVE, app),
  configProviderUpsert: (profile: ProviderProfile, apiKey?: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_PROVIDER_UPSERT, { profile, apiKey }),
  configProviderRemove: (id: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_PROVIDER_REMOVE, { id }),
  configDefaultModelSet: (defaultModel?: AppPreferences["defaultModel"]) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_DEFAULT_MODEL_SET, { defaultModel }),
  // ---- skills(M2;preload 仅透传)----
  configSkillsList: () => ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_SKILLS_LIST, {}),
  configSkillsImport: () => ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_SKILLS_IMPORT, {}),
  configSkillsSetEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_SKILLS_SET_ENABLED, { id, enabled }),
  configSkillsRemove: (id: string) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.CONFIG_SKILLS_REMOVE, { id }),
  // ---- push 事件订阅 ----
  onSessionEvent: (cb: (payload: SessionEventPayload) => void) =>
    subscribe(PUSH_CHANNELS.SESSION_EVENT, cb),
  onProcessState: (cb: (payload: ProcessStatePayload) => void) =>
    subscribe(PUSH_CHANNELS.PROCESS_STATE, cb),
} satisfies PideskBridge;

contextBridge.exposeInMainWorld("pidesk", bridge);
