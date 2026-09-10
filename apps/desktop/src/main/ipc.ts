// IPC 通道注册(T8a):按 shared/src/ipc.ts 契约逐条注册 invoke 处理器。
// 语义:载荷类型取自 InvokeMap[通道];处理器抛错 → 渲染进程 invoke reject(Electron 默认行为)。
// push 通道(SESSION_EVENT / PROCESS_STATE)不经此处,由 PiHostManager 内部定向 webContents.send。

import { dialog } from "electron";
import type { BrowserWindow, IpcMain } from "electron";
import { INVOKE_CHANNELS, type InvokeMap } from "@pidesk/shared";
import type { PiHostManager } from "./pi-host-manager.js";
import {
  loadConfig,
  removeProvider,
  saveAppPreferences,
  setDefaultModel,
  upsertProvider,
} from "./config-center.js";
import { importSkill, listSkills, removeSkill, setSkillEnabled } from "./skills-store.js";
import { listMcpServers, removeMcpServer, upsertMcpServer } from "./mcp-store.js";

/** ipcMain 最小结构(便于测试注入) */
type IpcMainLike = Pick<IpcMain, "handle">;

/** 按契约注册单通道:payload 类型 = InvokeMap[C][0],返回类型 = InvokeMap[C][1] */
function handle<C extends keyof InvokeMap>(
  ipc: IpcMainLike,
  channel: C,
  handler: (payload: InvokeMap[C][0]) => Promise<InvokeMap[C][1]> | InvokeMap[C][1],
): void {
  ipc.handle(channel, (_event, payload: InvokeMap[C][0]) => handler(payload));
}

/** 窗口创建后调用一次:把全部 invoke 通道接到 manager */
export function registerIpcHandlers(
  ipc: IpcMainLike,
  manager: PiHostManager,
  win: BrowserWindow,
  dataDir: string,
): void {
  // ---- 会话生命周期 ----
  handle(ipc, INVOKE_CHANNELS.SESSION_CREATE, async () => ({
    sessionId: await manager.createSession(win),
  }));

  // ---- 会话命令路由 ----
  handle(ipc, INVOKE_CHANNELS.SESSION_PROMPT, ({ sessionId, message }) =>
    manager.prompt(sessionId, message),
  );
  handle(ipc, INVOKE_CHANNELS.SESSION_ABORT, ({ sessionId }) => manager.abort(sessionId));
  handle(ipc, INVOKE_CHANNELS.SESSION_GET_STATE, ({ sessionId }) => manager.getState(sessionId));
  handle(ipc, INVOKE_CHANNELS.SESSION_SET_MODEL, ({ sessionId, provider, modelId }) =>
    manager.setModel(sessionId, provider, modelId),
  );
  handle(ipc, INVOKE_CHANNELS.SESSION_SET_THINKING_LEVEL, ({ sessionId, level }) =>
    manager.setThinkingLevel(sessionId, level),
  );
  handle(ipc, INVOKE_CHANNELS.SESSION_LIST_MODELS, ({ sessionId }) =>
    manager.listModels(sessionId),
  );

  // ---- 窗口控制(无边框窗口的自定义标题栏;直接挂到 win)----
  ipc.handle(INVOKE_CHANNELS.WINDOW_GET_STATE, () => ({ maximized: win.isMaximized() }));
  ipc.handle(INVOKE_CHANNELS.WINDOW_MINIMIZE, () => {
    win.minimize();
    return { maximized: win.isMaximized() };
  });
  ipc.handle(INVOKE_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { maximized: win.isMaximized() };
  });
  ipc.handle(INVOKE_CHANNELS.WINDOW_CLOSE, () => {
    win.close();
    return { maximized: false };
  });

  // ---- 模型连接配置(T11a 前内存态)----
  handle(ipc, INVOKE_CHANNELS.SETTINGS_GET_MODEL_CONFIG, () => manager.getModelConfig());
  handle(ipc, INVOKE_CHANNELS.SETTINGS_SET_MODEL_CONFIG, (config) =>
    manager.setModelConfig(config),
  );

  // ---- config-center(写操作后返回最新快照;快照不含明文 apiKey)----
  handle(ipc, INVOKE_CHANNELS.CONFIG_GET, () => loadConfig(dataDir));
  handle(ipc, INVOKE_CHANNELS.CONFIG_APP_SAVE, (app) => {
    saveAppPreferences(dataDir, app);
    return loadConfig(dataDir);
  });
  handle(ipc, INVOKE_CHANNELS.CONFIG_PROVIDER_UPSERT, ({ profile, apiKey }) => {
    upsertProvider(dataDir, profile, apiKey);
    return loadConfig(dataDir);
  });
  handle(ipc, INVOKE_CHANNELS.CONFIG_PROVIDER_REMOVE, ({ id }) => {
    removeProvider(dataDir, id);
    return loadConfig(dataDir);
  });
  handle(ipc, INVOKE_CHANNELS.CONFIG_DEFAULT_MODEL_SET, ({ defaultModel }) => {
    setDefaultModel(dataDir, defaultModel);
    return loadConfig(dataDir);
  });

  // ---- skills(M2) ----
  handle(ipc, INVOKE_CHANNELS.CONFIG_SKILLS_LIST, () => listSkills(dataDir));
  handle(ipc, INVOKE_CHANNELS.CONFIG_SKILLS_IMPORT, async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || r.filePaths.length === 0) {
      return { cancelled: true, skills: listSkills(dataDir) };
    }
    return { cancelled: false, skills: importSkill(dataDir, r.filePaths[0]!) };
  });
  handle(ipc, INVOKE_CHANNELS.CONFIG_SKILLS_SET_ENABLED, ({ id, enabled }) =>
    setSkillEnabled(dataDir, id, enabled),
  );
  handle(ipc, INVOKE_CHANNELS.CONFIG_SKILLS_REMOVE, ({ id }) => removeSkill(dataDir, id));

  // ---- MCP(M2;upsert/remove 后 store 内部已同步 pi-agent/mcp-generated.json)----
  handle(ipc, INVOKE_CHANNELS.CONFIG_MCP_LIST, () => listMcpServers(dataDir));
  handle(ipc, INVOKE_CHANNELS.CONFIG_MCP_UPSERT, ({ server }) =>
    upsertMcpServer(dataDir, server),
  );
  handle(ipc, INVOKE_CHANNELS.CONFIG_MCP_REMOVE, ({ id }) => removeMcpServer(dataDir, id));
}
