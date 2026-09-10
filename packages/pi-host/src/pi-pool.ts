/**
 * pi 进程池(T7a):多会话 → 单 pi 进程的槽位管理与兜底纯逻辑。
 *
 * 语义(定版,m1-design §7):
 *   ① 并发上限 4:acquire() 为会话分配槽位;已达上限抛错(信息含"并发已达上限 4");
 *      release(id) 回收槽位。
 *   ② 空闲回收 30min:每个活跃会话挂 idle 计时(经可注入 timer,便于 fake timers 测试);
 *      到期自动 stop 该会话并释放槽位;任何 request 重置计时。
 *   ③ 崩溃重启:onExit 报告 crashed → 自动重启,指数退避 1s/2s/4s(重试 ≤3 次);
 *      重启成功后若原 sessionFile 存在 → 调 switch_session 恢复上下文;
 *      3 次耗尽 → 不再自动拉起,向 onPoolError 回调报错。
 *   ④ 每会话 id→PiProcess 映射;create(创建)即绑定 onExit 处理。
 *
 * 注入化(延续 pi-process 风格):进程工厂 / timer / 文件存在性检查均可注入,
 * 单测传 fake 进程 + fake timers,不真 spawn。
 */

import { existsSync } from "node:fs";
import { PiProcess, type PiProcessExitInfo, type PiProcessState } from "./pi-process.js";

/** 并发上限(M1 定版:4) */
export const MAX_SESSIONS = 4;

/** 空闲回收阈值:30min 无活动自动回收 */
export const IDLE_RECLAIM_MS = 30 * 60 * 1000;

/** 崩溃重启指数退避序列(1s/2s/4s),重试 ≤3 次 */
export const RESTART_BACKOFF_MS: readonly [number, number, number] = [1_000, 2_000, 4_000];
/** 崩溃重启最大重试次数 */
export const MAX_RESTART_ATTEMPTS = 3;
/** 重启后稳定窗:进程存活超过此时长(2×最大退避)视为脱离崩溃循环,退避计数清零;期内再崩则升级直至耗尽 */
export const RESTART_STABLE_MS = 2 * RESTART_BACKOFF_MS[2];

/** 注入用进程最小接口(PiProcess 的结构子集;测试传 fake,真实 PiProcess 天然满足) */
export interface PoolProcessLike {
  /** 当前状态(判定 crashed → 走重启) */
  readonly state: PiProcessState;
  /** 启动并握手(成功即 ready) */
  start(dataDir: string, expectedVersion?: string, extraEnv?: NodeJS.ProcessEnv): Promise<unknown>;
  /** 宿主主动停(置 stopped,退出兜底见 PiProcess) */
  stop(): void;
  /** 发送任意命令 */
  request(
    command: string,
    args?: object,
    opts?: { timeoutMs?: number },
  ): Promise<{ success: true; data?: unknown } | { success: false; error: string }>;
  /** 进程退出上抛(crashed/stopped 均会到达) */
  onExit(cb: (info: PiProcessExitInfo) => void): void;
}

/** 注入用 timer 接口(空闲计时/重启退避共用;测试可注入手动 fake timers) */
export interface PoolTimer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 默认 timer:全局 setTimeout/clearTimeout(vitest fake timers 可直接劫持) */
const defaultTimer: PoolTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** 池级错误信息(onPoolError 上抛,当前仅重启耗尽) */
export interface PiPoolErrorInfo {
  /** 出问题的会话 id */
  sessionId: string;
  /** 错误描述 */
  message: string;
}

/** 构造选项(全部可注入,默认接真实实现) */
export interface PiPoolOptions {
  /** pi 数据目录(透传 PiProcess.start) */
  dataDir: string;
  /** 期望 pi 版本(透传 start,缺省不预检) */
  expectedVersion?: string;
  /** 进程工厂,默认 () => new PiProcess();测试注入 fake */
  processFactory?: () => PoolProcessLike;
  /** timer 实现,默认全局 setTimeout */
  timer?: PoolTimer;
  /** sessionFile 存在性检查(switch_session 恢复条件),默认 fs.existsSync */
  fileExists?: (path: string) => boolean;
}

/** 池内单会话条目 */
interface SessionEntry {
  id: string;
  /** 当前进程实例(重启后替换为新实例) */
  process: PoolProcessLike;
  /** 原始会话文件(崩溃重启后据此 switch_session 恢复;无则为 null) */
  sessionFile: string | null;
  /** 已执行的崩溃重启次数(超过稳定窗后清零) */
  restartAttempts: number;
  /** 重启已排程守卫(防 start 失败与 exit 事件双触发) */
  restartPending: boolean;
  /** idle 计时句柄 */
  idleTimer: unknown | null;
  /** 重启退避句柄 */
  restartTimer: unknown | null;
  /** 稳定窗计时句柄 */
  stableTimer: unknown | null;
}

export class PiPool {
  private readonly dataDir: string;
  private readonly expectedVersion: string | undefined;
  private readonly processFactory: () => PoolProcessLike;
  private readonly timer: PoolTimer;
  private readonly fileExists: (path: string) => boolean;

  /** 会话 id → 条目映射(持槽即入册) */
  private readonly sessions = new Map<string, SessionEntry>();
  private errorCbs: Array<(info: PiPoolErrorInfo) => void> = [];

  constructor(options: PiPoolOptions) {
    this.dataDir = options.dataDir;
    this.expectedVersion = options.expectedVersion;
    this.processFactory = options.processFactory ?? (() => new PiProcess());
    this.timer = options.timer ?? defaultTimer;
    this.fileExists = options.fileExists ?? ((p) => existsSync(p));
  }

  // ---- 回调注册 ----

  /** 池级错误(重启耗尽等)上抛 */
  onPoolError(cb: (info: PiPoolErrorInfo) => void): void {
    this.errorCbs.push(cb);
  }

  // ---- 查询 ----

  /** 当前活跃会话数(含重启中) */
  get size(): number {
    return this.sessions.size;
  }

  /** 按 id 取进程(不存在/已回收返回 undefined) */
  get(id: string): PoolProcessLike | undefined {
    return this.sessions.get(id)?.process;
  }

  // ---- 生命周期 ----

  /**
   * 为会话分配槽位并启动进程(创建即绑定 onExit 处理)。
   * 幂等:同 id 重复 acquire 返回现有进程,不占新槽。
   * @throws 并发已达上限(信息含"并发已达上限 4")/ start 失败(原样上抛,池内走崩溃重启)
   */
  async acquire(id: string, opts?: { sessionFile?: string | null; env?: NodeJS.ProcessEnv }): Promise<PoolProcessLike> {
    const existing = this.sessions.get(id);
    if (existing) return existing.process;
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`并发已达上限 ${MAX_SESSIONS},无法为会话 ${id} 分配进程槽位`);
    }
    const entry = this.createEntry(id, opts?.sessionFile ?? null);
    this.sessions.set(id, entry);
    try {
      await entry.process.start(this.dataDir, this.expectedVersion, opts?.env);
    } catch (err) {
      // 启动失败视同崩溃:走统一退避重试(exit 事件若也到达,由 restartPending 守卫去重)
      this.handleCrash(entry);
      throw err;
    }
    this.armIdleTimer(entry);
    return entry.process;
  }

  /** 回收槽位:清计时 → 移除映射 → 停进程(退出事件经 in-map 守卫静默) */
  release(id: string): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    this.sessions.delete(id);
    this.clearIdleTimer(entry);
    this.clearRestartTimer(entry);
    this.clearStableTimer(entry);
    entry.process.stop();
  }

  /**
   * 向会话发命令并重置空闲计时(任何 request 即活动)。
   * @throws 会话不存在
   */
  request(
    id: string,
    command: string,
    args?: object,
    opts?: { timeoutMs?: number },
  ): Promise<{ success: true; data?: unknown } | { success: false; error: string }> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`会话 ${id} 不存在`);
    this.armIdleTimer(entry);
    return entry.process.request(command, args, opts);
  }

  // ---- 内部:创建与绑定 ----

  /** 创建条目并绑定 onExit 处理(语义④:创建即绑定) */
  private createEntry(id: string, sessionFile: string | null): SessionEntry {
    const entry: SessionEntry = {
      id,
      process: this.processFactory(),
      sessionFile,
      restartAttempts: 0,
      restartPending: false,
      idleTimer: null,
      restartTimer: null,
      stableTimer: null,
    };
    entry.process.onExit(() => this.handleExit(entry));
    return entry;
  }

  /** 进程退出分流:crashed → 重启退避;其余(宿主 stop/意外零退)→ 出册释放 */
  private handleExit(entry: SessionEntry): void {
    if (this.sessions.get(entry.id) !== entry) return; // 已 release/回收,静默
    if (entry.process.state === "crashed") {
      this.handleCrash(entry);
    } else {
      this.sessions.delete(entry.id);
      this.clearIdleTimer(entry);
      this.clearStableTimer(entry);
    }
  }

  // ---- 内部:崩溃重启 ----

  /** crashed 入口:退避排程下一轮重启;耗尽则出册并上抛 onPoolError */
  private handleCrash(entry: SessionEntry): void {
    if (this.sessions.get(entry.id) !== entry) return;
    if (entry.restartPending) return; // start 失败与 exit 事件双触发去重
    this.clearIdleTimer(entry);
    this.clearStableTimer(entry);
    if (entry.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.sessions.delete(entry.id);
      this.emitPoolError(
        entry.id,
        `会话 ${entry.id} 崩溃重启 ${MAX_RESTART_ATTEMPTS} 次耗尽,不再自动拉起`,
      );
      return;
    }
    // 上方已守卫 attempts < 3,索引必在元组范围内
    const delay = RESTART_BACKOFF_MS[entry.restartAttempts]!;
    entry.restartAttempts++;
    entry.restartPending = true;
    entry.restartTimer = this.timer.setTimeout(() => {
      entry.restartTimer = null;
      void this.restartSession(entry);
    }, delay);
  }

  /** 执行一轮重启:新建进程(重新绑定)→ start → 成功则清计数并按需 switch_session 恢复 */
  private async restartSession(entry: SessionEntry): Promise<void> {
    entry.restartPending = false;
    const proc = this.processFactory();
    entry.process = proc;
    proc.onExit(() => this.handleExit(entry));
    try {
      await proc.start(this.dataDir, this.expectedVersion);
    } catch {
      this.handleCrash(entry); // 下一轮退避;耗尽判定在 handleCrash 内
      return;
    }
    if (this.sessions.get(entry.id) !== entry) return; // 重启期间被 release
    this.armIdleTimer(entry);
    this.armStableTimer(entry);
    const sessionFile = entry.sessionFile;
    if (sessionFile && this.fileExists(sessionFile)) {
      await proc.request("switch_session", { sessionPath: sessionFile });
    }
  }

  // ---- 内部:空闲回收 ----

  /** 稳定窗:重启后存活超过此时长即脱离崩溃循环,退避计数清零 */
  private armStableTimer(entry: SessionEntry): void {
    this.clearStableTimer(entry);
    entry.stableTimer = this.timer.setTimeout(() => {
      entry.stableTimer = null;
      entry.restartAttempts = 0;
    }, RESTART_STABLE_MS);
  }

  private clearStableTimer(entry: SessionEntry): void {
    if (entry.stableTimer !== null) {
      this.timer.clearTimeout(entry.stableTimer);
      entry.stableTimer = null;
    }
  }

  /**  arm/重置 idle 计时(任何 request 即活动) */
  private armIdleTimer(entry: SessionEntry): void {
    this.clearIdleTimer(entry);
    entry.idleTimer = this.timer.setTimeout(() => {
      entry.idleTimer = null;
      this.reclaimIdle(entry);
    }, IDLE_RECLAIM_MS);
  }

  /** idle 到期:出册释放槽位 → stop 进程(置 stopped,退出事件静默) */
  private reclaimIdle(entry: SessionEntry): void {
    if (this.sessions.get(entry.id) !== entry) return;
    this.sessions.delete(entry.id);
    entry.process.stop();
  }

  // ---- 内部:杂项 ----

  private clearIdleTimer(entry: SessionEntry): void {
    if (entry.idleTimer !== null) {
      this.timer.clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private clearRestartTimer(entry: SessionEntry): void {
    if (entry.restartTimer !== null) {
      this.timer.clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
  }

  private emitPoolError(sessionId: string, message: string): void {
    const info: PiPoolErrorInfo = { sessionId, message };
    this.errorCbs.forEach((cb) => cb(info));
  }
}
