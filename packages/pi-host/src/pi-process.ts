/**
 * pi 子进程状态机(T6):单 pi 进程生命周期管理。
 *
 * 状态机语义(定版):
 *   spawning ──进程启动──▶ handshaking ──get_state 成功──▶ ready
 *   handshaking 期 spawn 失败/预检失败 ──▶ crashed
 *   ready ──prompt/steer/follow_up 发出──▶ busy ──收到 agent_settled──▶ ready
 *   ready ──abort 已发──▶ stopping ──agent_end──▶ ready
 *   任意态 ──宿主主动 stop()──▶ stopped;L1 传输错误/非零退出──▶ crashed
 *
 * 退出兜底(DR-002):stop() 先 stdin.end() 优雅停 → 3s 后 SIGTERM →
 * 再 2s 后 SIGKILL;Windows 平台两阶段兜底均改用 taskkill /T 树杀
 * (宽限期先温和 taskkill,超时后 /F 强杀);三阶段定时器在进程先退出时全部清除。
 *
 * 依赖注入(防 mock 纠缠,T5b 教训):spawnImpl / rpcFactory / findInPath /
 * versionCheck 均可注入,单测传 fake,不 mock node:child_process。
 */

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createJsonlFramer } from "./jsonl-framing.js";
import { RpcClient, TIMEOUT_MS, type TransportErrorListener, type RpcFrame } from "./rpc-client.js";
import { buildPiEnv } from "./env.js";
import {
  checkPiVersion,
  resolvePiBinary,
  type VersionCheckResult,
  type VersionWarnListener,
} from "./version.js";

/** 进程状态全集 */
export type PiProcessState =
  | "spawning"
  | "handshaking"
  | "ready"
  | "busy"
  | "stopping"
  | "crashed"
  | "stopped";

/** 发出即转 busy 的命令集合(定版:prompt/steer/follow_up) */
const BUSY_COMMANDS = new Set(["prompt", "steer", "follow_up"]);

/** stderr 累积上限:超出保留尾部(最近的错误上下文最有价值) */
const STDERR_CAP = 64 * 1024;

/** 优雅停宽限:stdin.end() 后 3s 发 SIGTERM;再 2s(累计 5s)发 SIGKILL */
const TERM_GRACE_MS = 3_000;
const KILL_GRACE_MS = 2_000;

/** 生产默认:在 process.env.PATH 中查找可执行文件(测试注入 findInPath 时不被调用) */
function defaultFindInPath(name: string): string | null {
  const paths = (process.env.PATH ?? "").split(delimiter);
  for (const dir of paths) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Windows 树杀默认实现:taskkill /T(可选 /F)终止整棵进程树 */
const defaultKillTree = (pid: number, force: boolean): void => {
  const args = ["/pid", String(pid), "/T"];
  if (force) args.push("/F");
  const child = nodeSpawn("taskkill", args, { stdio: "ignore", windowsHide: true });
  child.on("error", () => { /* 已退/无 taskkill,忽略 */ });
};

/** 注入用子进程最小结构(真实 ChildProcess 的结构子集) */
export interface ChildProcessLike {
  pid?: number | undefined;
  stdin: { write(chunk: string): unknown; end(): unknown } | null;
  stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown } | null;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** 注入用 spawn 函数签名(默认 node:child_process 的 spawn) */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcessLike;

/** 注入用 RPC 客户端最小接口(RpcClient 的结构子集;测试传 fake) */
export interface RpcClientLike {
  request(
    command: string,
    args?: object,
    opts?: { timeoutMs?: number },
  ): Promise<{ success: true; data?: unknown } | { success: false; error: string }>;
  handleLine(line: string): void;
  onEvent(cb: (frame: RpcFrame) => void): void;
  onTransportError(cb: TransportErrorListener): void;
  close(): void;
}

/** 注入用 RPC 客户端工厂(默认内部创建 RpcClient) */
export type RpcFactoryLike = (sendRaw: (chunk: string) => void) => RpcClientLike;

/** 注入用版本预检(默认 checkPiVersion;测试传 fake) */
export type VersionCheckLike = (
  binary: string,
  expected: string,
  onWarn?: VersionWarnListener,
) => Promise<VersionCheckResult>;

/** 退出信息(经 onExit 上抛) */
export interface PiProcessExitInfo {
  /** 退出码(signal 非空时为 null) */
  code: number | null;
  /** 终止信号(正常退出为 null) */
  signal: string | null;
  /** stderr 尾部(≤64KB),供错误上下文 */
  stderrTail: string;
  /** spawn 进程级错误(error 事件)信息,仅 spawn 失败时存在 */
  spawnError?: string;
}

/** 构造依赖(全部可选,默认接真实实现) */
export interface PiProcessDeps {
  /** spawn 实现,默认 node:child_process 的 spawn */
  spawnImpl?: SpawnLike;
  /** RPC 客户端工厂,默认内部 new RpcClient */
  rpcFactory?: RpcFactoryLike;
  /** PATH 查找器(传给 resolvePiBinary),默认按 process.env.PATH 查找;测试可注入显式 fake */
  findInPath?: (name: string) => string | null;
  /** 版本预检实现,默认 checkPiVersion */
  versionCheck?: VersionCheckLike;
  /** 进程平台(默认 process.platform);测试可注入 "win32" */
  platform?: NodeJS.Platform;
  /** 树杀实现(仅 Windows 分支使用);默认 spawn taskkill */
  killTree?: (pid: number, force: boolean) => void;
}

type StateListener = (state: PiProcessState, snapshot?: unknown) => void;
type EventListener = (frame: RpcFrame) => void;
type ExitListener = (info: PiProcessExitInfo) => void;

export class PiProcess {
  private readonly spawnImpl: SpawnLike;
  private readonly rpcFactory: RpcFactoryLike;
  private readonly findInPath: (name: string) => string | null;
  private readonly versionCheck: VersionCheckLike;
  private readonly platform: NodeJS.Platform;
  private readonly killTree: (pid: number, force: boolean) => void;

  private _state: PiProcessState = "spawning";
  private proc: ChildProcessLike | null = null;
  private client: RpcClientLike | null = null;
  private framer: { push(chunk: Buffer | string): void; end(): void } | null = null;
  /** exit 事件已到达(spawn error 不置位;防重入) */
  private exited = false;
  /** ready 之前到达的会话事件缓冲,握手完成后按序重放 */
  private eventBuffer: RpcFrame[] = [];
  /** stderr 累积(≤64KB,保留尾部) */
  private stderrBuf = "";
  /** spawn error 事件信息(供 onExit) */
  private spawnErrorMsg: string | undefined;
  /** 兜底定时器:3s SIGTERM / 5s SIGKILL */
  private termTimer: ReturnType<typeof setTimeout> | null = null;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  /** start 去重守卫 */
  private startPromise: Promise<unknown> | null = null;

  private stateCbs: StateListener[] = [];
  private eventCbs: EventListener[] = [];
  private exitCbs: ExitListener[] = [];
  private warnCbs: VersionWarnListener[] = [];

  constructor(deps: PiProcessDeps = {}) {
    this.spawnImpl =
      deps.spawnImpl ??
      ((command, args, options) =>
        nodeSpawn(command, args, { env: options.env, stdio: options.stdio }) as ChildProcessLike);
    this.rpcFactory = deps.rpcFactory ?? ((sendRaw) => new RpcClient(sendRaw));
    this.findInPath = deps.findInPath ?? defaultFindInPath;
    this.versionCheck = deps.versionCheck ?? checkPiVersion;
    this.platform = deps.platform ?? process.platform;
    this.killTree = deps.killTree ?? defaultKillTree;
  }

  /** 当前状态 */
  get state(): PiProcessState {
    return this._state;
  }

  /** stderr 尾部(≤64KB),供错误上报 */
  get stderrTail(): string {
    return this.stderrBuf;
  }

  // ---- 回调注册 ----

  /** 状态每次迁移上抛;ready 迁移时第二参为握手状态快照 */
  onState(cb: StateListener): void {
    this.stateCbs.push(cb);
  }

  /** 会话事件透传(ready 前缓冲,握手完成后按序重放) */
  onEvent(cb: EventListener): void {
    this.eventCbs.push(cb);
  }

  /** 进程退出(含 code/signal/stderr 尾部/spawn 错误) */
  onExit(cb: ExitListener): void {
    this.exitCbs.push(cb);
  }

  /** 版本不匹配告警(不阻断) */
  onWarn(cb: VersionWarnListener): void {
    this.warnCbs.push(cb);
  }

  // ---- 生命周期 ----

  /**
   * 启动 pi 进程并握手。流程:resolve 二进制 → 版本预检(不匹配仅 onWarn)→
   * buildPiEnv → spawn <binary> --mode rpc → 握手 get_state → ready。
   * @returns 握手快照(get_state 的 data)
   * @rejects 预检失败/spawn 失败/握手失败(此时状态已迁 crashed)
   */
  start(dataDir: string, expectedVersion?: string): Promise<unknown> {
    if (this.startPromise) {
      return Promise.reject(new Error("PiProcess.start 已调用,禁止重复启动"));
    }
    this.startPromise = this.doStart(dataDir, expectedVersion);
    return this.startPromise;
  }

  private async doStart(dataDir: string, expectedVersion?: string): Promise<unknown> {
    try {
      // ① 解析二进制(解析失败 = 预检失败 → crashed)
      const binary = resolvePiBinary(process.env, this.findInPath);
      // ② 版本预检:不匹配仅告警不阻断;执行失败抛错 → crashed
      if (expectedVersion !== undefined) {
        await this.versionCheck(binary, expectedVersion, (info) => {
          this.warnCbs.forEach((cb) => cb(info));
        });
      }
      this.setState("handshaking");
      // ③ spawn:<binary> --mode rpc,注入隔离 env(buildPiEnv 叠加在 process.env 之上)
      const child = this.spawnImpl(binary, ["--mode", "rpc"], {
        env: { ...process.env, ...buildPiEnv(dataDir) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.proc = child;
      child.on("error", (...args: unknown[]) => {
        const err = args[0];
        this.spawnErrorMsg = err instanceof Error ? err.message : String(err);
        this.crash(`spawn 失败: ${this.spawnErrorMsg}`);
      });
      child.on("exit", (...args: unknown[]) => {
        this.handleExit(args[0] as number | null, args[1] as string | null);
      });
      // spawn 失败(如 ENOENT)时 Node 只发 error+close 不发 exit;复用同一收尾(exited 防重入)
      child.on("close", (...args: unknown[]) => {
        this.handleExit(args[0] as number | null, args[1] as string | null);
      });
      // ④ 接线:stdout → framer → client.handleLine;stderr → 累积(≤64KB)
      this.client = this.rpcFactory((chunk) => {
        child.stdin?.write(chunk);
      });
      this.client.onEvent((frame) => this.consumeEvent(frame));
      this.client.onTransportError((reason) => this.onTransportError(reason));
      this.framer = createJsonlFramer((line) => {
        this.client?.handleLine(line);
      });
      child.stdout?.on("data", (chunk) => this.framer?.push(chunk));
      child.stderr?.on("data", (chunk) => this.appendStderr(chunk));
      // ⑤ 握手:get_state 成功 → ready,快照经 onState 上抛
      const res = await this.client.request("get_state", undefined, {
        timeoutMs: TIMEOUT_MS.quick,
      });
      if (!res.success) throw new Error(`get_state 握手失败: ${res.error}`);
      this.setState("ready", res.data);
      // ⑥ 重放握手期缓冲的会话事件(按序)
      const buffered = this.eventBuffer;
      this.eventBuffer = [];
      for (const frame of buffered) this.emitEvent(frame);
      return res.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.crash(`启动失败: ${msg}`);
      throw new Error(
        `PiProcess 启动失败: ${msg}(stderr 尾部: ${this.stderrBuf.slice(-500) || "无"})`,
        { cause: err },
      );
    }
  }

  /**
   * 发送任意命令。仅 ready/busy 允许;busy 命令(prompt/steer/follow_up)
   * 发出即转 busy,失败时防御性回退 ready。
   */
  request(
    command: string,
    args?: object,
    opts?: { timeoutMs?: number },
  ): Promise<{ success: true; data?: unknown } | { success: false; error: string }> {
    const client = this.readyClientOrThrow(command);
    if (BUSY_COMMANDS.has(command) && this._state === "ready") {
      this.setState("busy");
      return client.request(command, args, opts).then(
        (v) => v,
        (err) => {
          // 防御回退:请求失败意味着不会有 agent_settled,避免卡死在 busy
          if (this._state === "busy") this.setState("ready");
          throw err;
        },
      );
    }
    return client.request(command, args, opts);
  }

  /** abort:发 abort 命令进 stopping;agent_end 事件回 ready */
  abort(): Promise<{ success: true; data?: unknown } | { success: false; error: string }> {
    const client = this.readyClientOrThrow("abort");
    this.setState("stopping");
    return client.request("abort", undefined, { timeoutMs: TIMEOUT_MS.quick }).then(
      (v) => v,
      (err) => {
        // 防御回退:abort 发送失败(且未被宿主 stop)时回 ready,避免卡死
        if (this._state === "stopping") this.setState("ready");
        throw err;
      },
    );
  }

  /**
   * 宿主主动停(DR-002 兜底):stdin.end() 优雅停 → 3s 后 SIGTERM →
   * 再 2s 后 SIGKILL。进程先退出时三阶段定时器全部清除。
   * 任意态可调;stopped/crashed 已是终态则仅做资源清理。
   */
  stop(): void {
    if (this._state !== "stopped" && this._state !== "crashed") {
      this.setState("stopped");
    }
    this.clearKillTimers();
    if (this.exited) return; // 进程已退,无需兜底
    try {
      this.proc?.stdin?.end();
    } catch {
      /* 传输已断,忽略 */
    }
    // close() 会拒绝全部在途请求(transport_closed);状态已是 stopped,不会误判 crashed
    try {
      this.client?.close();
    } catch {
      /* 幂等,忽略 */
    }
    this.termTimer = setTimeout(() => {
      try {
        if (this.platform === "win32" && this.proc?.pid !== undefined) {
          this.killTree(this.proc.pid, false);
        } else {
          this.proc?.kill("SIGTERM");
        }
      } catch {
        /* 已退,忽略 */
      }
    }, TERM_GRACE_MS);
    this.killTimer = setTimeout(() => {
      const pid = this.proc?.pid;
      try {
        if (this.platform === "win32" && pid !== undefined) {
          this.killTree(pid, true);
        } else {
          this.proc?.kill("SIGKILL");
        }
      } catch {
        /* 已退,忽略 */
      }
    }, TERM_GRACE_MS + KILL_GRACE_MS);
  }

  // ---- 内部:状态迁移与回调 ----

  /** 迁移状态并经 onState 上抛(同态幂等) */
  private setState(next: PiProcessState, snapshot?: unknown): void {
    if (this._state === next) return;
    this._state = next;
    this.stateCbs.forEach((cb) => cb(next, snapshot));
  }

  private emitEvent(frame: RpcFrame): void {
    this.eventCbs.forEach((cb) => cb(frame));
  }

  /** RPC 客户端事件消费:先做状态迁移,再缓冲/转发 */
  private consumeEvent(frame: RpcFrame): void {
    const type = frame !== null && typeof frame === "object" ? frame.type : undefined;
    if (this._state === "busy" && type === "agent_settled") {
      this.setState("ready");
    } else if (this._state === "stopping" && type === "agent_end") {
      this.setState("ready");
    }
    // ready 之前到达的会话事件入队,握手完成后按序重放
    if (this._state === "spawning" || this._state === "handshaking") {
      this.eventBuffer.push(frame);
    } else {
      this.emitEvent(frame);
    }
  }

  /** L1 传输错误(含 rpc-client 的 protocol_broken):非宿主停机 → crashed */
  private onTransportError(reason: string): void {
    if (this.exited) return; // 退出流程内的正常断裂,忽略
    if (this._state === "stopped" || this._state === "crashed") return;
    this.crash(`L1 传输错误: ${reason}`);
  }

  /** 进入 crashed(终态);若进程仍活着则直接 SIGKILL,交由 exit 事件收尾 */
  private crash(reason: string): void {
    // reason 为调用方语义标注,当前不参与终态迁移(显式消费以避开 no-unused-vars)
    void reason;
    if (this._state !== "crashed" && this._state !== "stopped") {
      this.setState("crashed");
    }
    if (!this.exited) {
      try {
        this.proc?.kill("SIGKILL");
      } catch {
        /* 已退,忽略 */
      }
      try {
        this.client?.close();
      } catch {
        /* 幂等,忽略 */
      }
    }
  }

  /** exit 事件:清定时器 → 关客户端 → 终态判定 → onExit 上抛 */
  private handleExit(code: number | null, signal: string | null): void {
    if (this.exited) return; // 防重入
    this.exited = true;
    this.clearKillTimers();
    // 关客户端:在途请求统一拒绝(transport_closed);其回调经 exited 守卫忽略
    try {
      this.client?.close();
    } catch {
      /* 幂等,忽略 */
    }
    // 终态判定:宿主 stop 已置 stopped;非零退出/信号 → crashed;意外零退 → stopped
    if (this._state !== "stopped" && this._state !== "crashed") {
      if (code === 0 && signal === null) {
        this.setState("stopped");
      } else {
        this.setState("crashed");
      }
    }
    const info: PiProcessExitInfo = {
      code,
      signal,
      stderrTail: this.stderrBuf,
      ...(this.spawnErrorMsg !== undefined ? { spawnError: this.spawnErrorMsg } : {}),
    };
    this.exitCbs.forEach((cb) => cb(info));
  }

  /** stderr 累积,超出上限保留尾部 */
  private appendStderr(chunk: Buffer | string): void {
    this.stderrBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (this.stderrBuf.length > STDERR_CAP) {
      this.stderrBuf = this.stderrBuf.slice(-STDERR_CAP);
    }
  }

  /** 清除三阶段兜底定时器(进程先退出时调用) */
  private clearKillTimers(): void {
    if (this.termTimer !== null) {
      clearTimeout(this.termTimer);
      this.termTimer = null;
    }
    if (this.killTimer !== null) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }

  /** 发命令前置校验:仅 ready/busy 允许 */
  private readyClientOrThrow(command: string): RpcClientLike {
    if (this._state !== "ready" && this._state !== "busy") {
      throw new Error(`当前状态 ${this._state} 不允许发送 ${command}`);
    }
    if (!this.client) throw new Error("RPC 客户端未初始化");
    return this.client;
  }
}
