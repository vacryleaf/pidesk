// 主进程 pi 宿主管理器(T8a):封装 PiPool + 会话注册表,面向 IPC 层提供语义路由。
// 职责(m1-design §7):
// - createSession(win):池 acquire + 进程事件挂接(SESSION_EVENT / PROCESS_STATE 按 sessionId 定向 push);
// - destroySession(id):池 release + 出册;
// - invoke 语义路由:prompt / abort / get_state / set_model / set_thinking_level / get_available_models;
// - extension_ui_request 的 confirm/select/input 暂入队(M2 前不弹),notify 及其余帧经 SESSION_EVENT 透传。

import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { PiPool, bootstrapDataDir, type PoolProcessLike } from "@pidesk/pi-host";
import {
  PUSH_CHANNELS,
  resolveDataDir,
  type ExtensionUIRequest,
  type ModelInfo,
  type PideskProcessState,
  type ProviderConfig,
  type RpcSessionState,
} from "@pidesk/shared";

/** 宿主侧进程最小接口:PoolProcessLike + 事件/状态推送挂接(真实 PiProcess 天然满足) */
interface HostProcessLike extends PoolProcessLike {
  /** 会话事件透传(含 JsonAgentSessionEvent / extension_ui_request / ExtensionError 帧) */
  onEvent(cb: (frame: unknown) => void): void;
  /** 状态迁移上抛 */
  onState(cb: (state: PideskProcessState, snapshot?: unknown) => void): void;
}

/** 会话注册表条目:会话 id → 进程 + 目标窗口 */
interface SessionRecord {
  process: HostProcessLike;
  win: BrowserWindow;
  /** extension_ui_request(confirm/select/input)入队,M2 接 UI 后消化 */
  pendingUiRequests: ExtensionUIRequest[];
}

/** 内存默认 ProviderConfig(T11a 接落盘前的占位) */
const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  preset: "ollama",
  baseUrl: "http://localhost:11434/v1",
  modelId: "",
  saveKey: false,
};

/** get_available_models 返回的 Model 结构子集(仅取映射所需字段,防御式访问) */
interface RawModel {
  provider?: unknown;
  id?: unknown;
  name?: unknown;
}

export class PiHostManager {
  private readonly pool: PiPool;
  /** 会话注册表:sessionId → {process, win} */
  private readonly sessions = new Map<string, SessionRecord>();
  /** 模型连接配置(T11a 前仅内存) */
  private modelConfig: ProviderConfig = { ...DEFAULT_PROVIDER_CONFIG };

  constructor(dataDir: string = resolveDataDir(process.env)) {
    // 数据目录 bootstrap(幂等):建目录 + 原子写 settings.json
    bootstrapDataDir(dataDir);
    this.pool = new PiPool({ dataDir });
    // 池级错误(崩溃重启耗尽)暂仅打日志,M2 接渲染层提示
    this.pool.onPoolError((info) => {
      console.error(`[pi-host] ${info.message}`);
    });
  }

  // ---- 会话生命周期 ----

  /** 创建会话:生成 id → 池 acquire(启动+握手)→ 挂事件推送 → 入册;返回 sessionId */
  async createSession(win: BrowserWindow): Promise<string> {
    const sessionId = randomUUID();
    const proc = (await this.pool.acquire(sessionId)) as HostProcessLike;
    const record: SessionRecord = { process: proc, win, pendingUiRequests: [] };
    this.sessions.set(sessionId, record);
    this.wireProcess(sessionId, record);
    return sessionId;
  }

  /** 销毁会话:出册 + 池 release(清计时/停进程) */
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.pool.release(sessionId);
  }

  // ---- invoke 语义路由(契约见 shared/src/ipc.ts InvokeMap)----

  /** session:prompt:发 prompt(PiProcess 内部发即转 busy,agent_settled 回 ready) */
  async prompt(sessionId: string, message: string): Promise<{ ok: boolean }> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "prompt", { message });
    return { ok: res.success };
  }

  /** session:abort */
  async abort(sessionId: string): Promise<{ ok: boolean }> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "abort");
    return { ok: res.success };
  }

  /** session:getState:返回 RpcSessionState 快照;失败上抛(invoke 侧 reject) */
  async getState(sessionId: string): Promise<RpcSessionState> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "get_state");
    if (!res.success) throw new Error(`get_state 失败: ${res.error}`);
    return res.data as RpcSessionState;
  }

  /** session:setModel */
  async setModel(sessionId: string, provider: string, modelId: string): Promise<{ ok: boolean }> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "set_model", { provider, modelId });
    return { ok: res.success };
  }

  /** session:setThinkingLevel */
  async setThinkingLevel(sessionId: string, level: string): Promise<{ ok: boolean }> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "set_thinking_level", { level });
    return { ok: res.success };
  }

  /** session:listModels:get_available_models → ModelInfo[](防御式字段映射) */
  async listModels(sessionId: string): Promise<{ models: ModelInfo[] }> {
    this.ensureWired(sessionId);
    const res = await this.pool.request(sessionId, "get_available_models");
    if (!res.success) throw new Error(`get_available_models 失败: ${res.error}`);
    const raw = (res.data as { models?: RawModel[] } | undefined)?.models ?? [];
    const models: ModelInfo[] = raw.map((m) => ({
      provider: typeof m.provider === "string" ? m.provider : "",
      modelId: typeof m.id === "string" ? m.id : "",
      ...(typeof m.name === "string" ? { name: m.name } : {}),
    }));
    return { models };
  }

  // ---- 模型连接配置(T11a 前内存态)----

  /** settings:getModelConfig:返回前 apiKey 脱敏(契约注释要求) */
  getModelConfig(): ProviderConfig {
    return this.redactConfig(this.modelConfig);
  }

  /** settings:setModelConfig:内存保存并回显脱敏副本 */
  setModelConfig(config: ProviderConfig): ProviderConfig {
    this.modelConfig = { ...config };
    return this.redactConfig(this.modelConfig);
  }

  /** apiKey 脱敏:存在则替换为 "***" */
  private redactConfig(config: ProviderConfig): ProviderConfig {
    return { ...config, ...(config.apiKey ? { apiKey: "***" } : {}) };
  }

  // ---- 内部:事件挂接与进程实例追踪 ----

  /**
   * 挂接事件/状态推送(按 sessionId 定向到注册窗口)。
   * 崩溃重启后池内会替换新进程实例;新实例经 ensureWired 惰性重挂(M1 限制:
   * 重启完成到下一次 invoke 之间的新进程事件不推送,M2 池补替换钩子后消除)。
   */
  private wireProcess(sessionId: string, record: SessionRecord): void {
    const send = (channel: string, payload: unknown): void => {
      if (!record.win.isDestroyed()) {
        record.win.webContents.send(channel, payload);
      }
    };
    record.process.onEvent((frame) => {
      const type = frame !== null && typeof frame === "object" ? (frame as { type?: unknown }).type : undefined;
      if (type === "extension_ui_request") {
        const method = (frame as { method?: unknown }).method;
        // confirm/select/input 暂入队,M2 接 UI 后消化;其余(notify 等)透传
        if (method === "confirm" || method === "select" || method === "input") {
          record.pendingUiRequests.push(frame as ExtensionUIRequest);
          return;
        }
      }
      // JsonAgentSessionEvent / notify / ExtensionError 等统一经 SESSION_EVENT 透传
      send(PUSH_CHANNELS.SESSION_EVENT, { sessionId, event: frame });
    });
    record.process.onState((state) => {
      send(PUSH_CHANNELS.PROCESS_STATE, { sessionId, state });
    });
  }

  /**
   * 取会话记录并对齐进程实例:池内进程已因崩溃重启替换时,更新记录并重挂事件。
   * @throws 会话不存在
   */
  private ensureWired(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`会话 ${sessionId} 不存在`);
    const current = this.pool.get(sessionId);
    if (current && current !== record.process) {
      record.process = current as HostProcessLike;
      this.wireProcess(sessionId, record);
    }
    return record;
  }
}
