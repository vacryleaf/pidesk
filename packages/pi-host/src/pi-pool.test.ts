// pi-pool 单元测试:fake 进程注入 + vitest fake timers(走默认 timer 实现,验证可被劫持)。
// 覆盖:并发上限拒绝 / 空闲回收与 request 重置 / 崩溃退避序列 1s-2s-4s / switch_session 恢复 / 耗尽报错。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";import {
  PiPool,
  IDLE_RECLAIM_MS,
  MAX_SESSIONS,
  RESTART_BACKOFF_MS,
  RESTART_STABLE_MS,
  type PoolProcessLike,
  type PiPoolErrorInfo,
} from "./pi-pool.js";
import type { PiProcessExitInfo, PiProcessState } from "./pi-process.js";

/** 注入用 fake 进程:记录 start/stop/request,onExit 回调由测试手动 crash 派发 */
class FakePiProcess implements PoolProcessLike {
  state: PiProcessState = "spawning";
  startCalls = 0;
  stopCalls = 0;
  requests: Array<{ command: string; args?: object }> = [];
  /** 非空时 start 直接 reject(模拟预检/spawn 前失败,不派发 exit) */
  startError: Error | null = null;
  private exitCbs: Array<(info: PiProcessExitInfo) => void> = [];

  start(): Promise<unknown> {
    this.startCalls++;
    if (this.startError) return Promise.reject(this.startError);
    this.state = "ready";
    return Promise.resolve({});
  }

  stop(): void {
    this.stopCalls++;
    this.state = "stopped";
  }

  request(command: string, args?: object): Promise<{ success: true; data?: unknown }> {
    this.requests.push({ command, args });
    return Promise.resolve({ success: true, data: {} });
  }

  onExit(cb: (info: PiProcessExitInfo) => void): void {
    this.exitCbs.push(cb);
  }

  /** 模拟崩溃:置 crashed 并派发 exit(onExit 回调读 state 判定 crashed) */
  crash(): void {
    this.state = "crashed";
    const info: PiProcessExitInfo = { code: 1, signal: null, stderrTail: "boom" };
    this.exitCbs.forEach((cb) => cb(info));
  }
}

/** 测试装配器:队列式 fake 工厂 + 回调收集 */
function makePool(opts: {
  fileExists?: (path: string) => boolean;
  /** 首个 fake 的 start 直接失败(模拟预检/spawn 前失败) */
  failFirstStart?: boolean;
} = {}) {
  const procs: FakePiProcess[] = [];
  const factory = vi.fn((): PoolProcessLike => {
    const p = new FakePiProcess();
    if (opts.failFirstStart && procs.length === 0) {
      p.startError = new Error("spawn 失败");
    }
    procs.push(p);
    return p;
  });
  const errors: PiPoolErrorInfo[] = [];
  const pool = new PiPool({
    dataDir: "/fake/data",
    processFactory: factory,
    fileExists: opts.fileExists ?? (() => false),
  });
  pool.onPoolError((info) => errors.push(info));
  return { pool, procs, factory, errors };
}

const MIN = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers(); // 劫持全局 setTimeout,验证默认 timer 实现可被 fake timers 驱动
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PiPool 并发上限", () => {
  it("第 5 个 acquire 抛错(信息含:并发已达上限 4)", async () => {
    const { pool, procs } = makePool();
    for (let i = 0; i < MAX_SESSIONS; i++) {
      await pool.acquire(`s${i}`);
    }
    expect(procs.length).toBe(MAX_SESSIONS);
    await expect(pool.acquire("s5")).rejects.toThrow(/并发已达上限 4/);
    expect(procs.length).toBe(MAX_SESSIONS);
  });

  it("release 回收槽位后可再次 acquire", async () => {
    const { pool, procs } = makePool();
    for (let i = 0; i < MAX_SESSIONS; i++) {
      await pool.acquire(`s${i}`);
    }
    pool.release("s0");
    expect(procs[0]!.stopCalls).toBe(1);
    expect(pool.get("s0")).toBeUndefined();
    await expect(pool.acquire("s5")).resolves.toBeDefined();
    expect(pool.size).toBe(MAX_SESSIONS);
  });

  it("同 id 重复 acquire 幂等,不占新槽", async () => {
    const { pool, procs } = makePool();
    const first = await pool.acquire("s1");
    const again = await pool.acquire("s1");
    expect(again).toBe(first);
    expect(procs.length).toBe(1);
  });
});

describe("PiPool 空闲回收", () => {
  it("30min 无活动自动 stop 并释放槽位", async () => {
    const { pool, procs } = makePool();
    await pool.acquire("s1");
    await vi.advanceTimersByTimeAsync(IDLE_RECLAIM_MS - 1);
    expect(procs[0]!.stopCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs[0]!.stopCalls).toBe(1);
    expect(pool.get("s1")).toBeUndefined();
    expect(pool.size).toBe(0);
  });

  it("任何 request 重置 idle 计时", async () => {
    const { pool, procs } = makePool();
    await pool.acquire("s1");
    await vi.advanceTimersByTimeAsync(29 * MIN);
    await pool.request("s1", "get_state");
    // 距 request 又 29min:原 30min 计时若未重置早已到期,现在仍应存活
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(procs[0]!.stopCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(procs[0]!.stopCalls).toBe(1);
  });

  it("request 不存在的会话抛错", () => {
    const { pool } = makePool();
    expect(() => pool.request("ghost", "get_state")).toThrow(/不存在/);
  });
});

describe("PiPool 崩溃重启退避", () => {
  it("指数退避序列 1s → 2s → 4s", async () => {
    const { pool, procs, errors } = makePool();
    await pool.acquire("s1");
    // 第 1 次崩溃:999ms 未重启,1s 整重启
    procs[0]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]! - 1);
    expect(procs.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs.length).toBe(2);
    expect(procs[1]!.startCalls).toBe(1);
    // 第 2 次崩溃:退避 2s
    procs[1]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[1]! - 1);
    expect(procs.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs.length).toBe(3);
    // 第 3 次崩溃:退避 4s
    procs[2]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[2]! - 1);
    expect(procs.length).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(procs.length).toBe(4);
    expect(errors.length).toBe(0);
    expect(pool.size).toBe(1);
  });

  it("重启后短期内再崩 → 退避升级(1s 不再重启)", async () => {
    const { pool, procs } = makePool();
    await pool.acquire("s1");
    procs[0]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!); // 第一次重启
    procs[1]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!); // 短期内再崩:1s 不够
    expect(procs.length).toBe(2);
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!); // 累计 2s 才重启
    expect(procs.length).toBe(3);
  });

  it("存活超稳定窗后退避计数清零(后续崩溃重新从 1s 起)", async () => {
    const { pool, procs } = makePool();
    await pool.acquire("s1");
    procs[0]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!); // 第一次重启
    await vi.advanceTimersByTimeAsync(RESTART_STABLE_MS); // 稳定窗经过,计数清零
    procs[1]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!); // 重新从 1s 起
    expect(procs.length).toBe(3);
  });

  it("acquire 时 start 失败视同崩溃,走退避重启", async () => {
    const { pool, procs, errors } = makePool({ failFirstStart: true });
    await expect(pool.acquire("s1")).rejects.toThrow(/spawn 失败/);
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!);
    expect(procs.length).toBe(2);
    expect(procs[1]!.startCalls).toBe(1);
    expect(pool.get("s1")).toBe(procs[1]);
    expect(errors.length).toBe(0);
  });
});

describe("PiPool 会话恢复(switch_session)", () => {
  it("重启成功且原 sessionFile 存在 → 调 switch_session 恢复", async () => {
    const { pool, procs } = makePool({ fileExists: () => true });
    await pool.acquire("s1", { sessionFile: "/fake/sessions/a.jsonl" });
    procs[0]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!);
    expect(procs[1]!.requests).toContainEqual({
      command: "switch_session",
      args: { sessionPath: "/fake/sessions/a.jsonl" },
    });
  });

  it("sessionFile 不存在或未提供 → 不调 switch_session", async () => {
    const { pool, procs } = makePool({ fileExists: () => false });
    await pool.acquire("s1", { sessionFile: "/fake/sessions/a.jsonl" });
    await pool.acquire("s2");
    procs[0]!.crash();
    procs[1]!.crash();
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!);
    expect(procs[1]!.requests).toEqual([]);
    expect(procs[2]!.requests).toEqual([]);
  });
});

describe("PiPool 重启耗尽", () => {
  it("3 次耗尽后不再拉起,向 onPoolError 报错并释放槽位", async () => {
    const { pool, procs, errors } = makePool();
    await pool.acquire("s1");
    for (let i = 0; i < MAX_SESSIONS; i++) {
      procs[i]!.crash();
      // 第 4 次崩溃(3 次重启耗尽)立即报错,无退避排程
      if (i < 3) await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[i]!);
    }
    expect(errors.length).toBe(1);
    expect(errors[0]!.sessionId).toBe("s1");
    expect(errors[0]!.message).toContain("不再自动拉起");
    expect(pool.get("s1")).toBeUndefined();
    expect(pool.size).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(procs.length).toBe(4); // 不再自动拉起
  });

  it("release 可取消重启排程", async () => {
    const { pool, procs } = makePool();
    await pool.acquire("s1");
    procs[0]!.crash();
    await vi.advanceTimersByTimeAsync(500);
    pool.release("s1");
    await vi.advanceTimersByTimeAsync(RESTART_BACKOFF_MS[0]!);
    expect(procs.length).toBe(1);
    expect(pool.size).toBe(0);
  });
});
