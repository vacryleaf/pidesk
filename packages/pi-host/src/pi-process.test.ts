// pi-process 单元测试:注入 fake spawn + fake/real client,覆盖全部状态迁移与三阶段兜底定时器(fake timers)。
// 纪律:不 mock node:child_process(T5b 教训,hoisting/展开引发异常调用),全部经构造注入 fake。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcClient } from "./rpc-client.js";
import { PiProcess, type ChildProcessLike } from "./pi-process.js";

/** 注入用 fake 子进程:记录 stdin 写入 / kill 信号,手动派发 stdout/stderr/error/exit */
function makeFakeChild() {
  type Cb = (...args: unknown[]) => void;
  const handlers = new Map<string, Cb[]>();
  const stdinWrites: string[] = [];
  let stdinEnded = false;
  const kills: string[] = [];
  const on = (event: string, cb: Cb) => {
    const list = handlers.get(event) ?? [];
    list.push(cb);
    handlers.set(event, list);
  };
  const child: ChildProcessLike = {
    pid: 4242,
    stdin: {
      write: (chunk: string) => {
        stdinWrites.push(chunk);
      },
      end: () => {
        stdinEnded = true;
      },
    },
    stdout: { on: (ev, cb) => on(`stdout:${ev}`, cb as Cb) },
    stderr: { on: (ev, cb) => on(`stderr:${ev}`, cb as Cb) },
    on,
    kill: (signal?: NodeJS.Signals | number) => {
      kills.push(String(signal));
      return true;
    },
  };
  const emit = (key: string, ...args: unknown[]) => {
    (handlers.get(key) ?? []).forEach((cb) => cb(...args));
  };
  return {
    child,
    stdinWrites,
    kills,
    isEnded: () => stdinEnded,
    stdoutData: (chunk: string) => emit("stdout:data", Buffer.from(chunk, "utf8")),
    stderrData: (chunk: string) => emit("stderr:data", Buffer.from(chunk, "utf8")),
    emitError: (err: Error) => emit("error", err),
    emitExit: (code: number | null, signal: string | null) => emit("exit", code, signal),
  };
}

/** 注入用 fake RPC 客户端:请求挂起由测试手动 resolve/reject;close 拒绝全部在途(对齐真实语义) */
class FakeClient {
  requests: Array<{ command: string; args?: object }> = [];
  closeCount = 0;
  private resolvers = new Map<string, (v: any) => void>();
  private rejecters = new Map<string, (e: any) => void>();
  private eventCbs: Array<(f: any) => void> = [];
  private transportCbs: Array<(r: string) => void> = [];

  request(command: string, args?: object, _opts?: { timeoutMs?: number }): Promise<any> {
    this.requests.push({ command, args });
    return new Promise((resolve, reject) => {
      this.resolvers.set(command, resolve);
      this.rejecters.set(command, reject);
    });
  }
  handleLine(_line: string): void {}
  onEvent(cb: (f: any) => void): void {
    this.eventCbs.push(cb);
  }
  onTransportError(cb: (r: string) => void): void {
    this.transportCbs.push(cb);
  }
  close(): void {
    this.closeCount++;
    for (const rej of this.rejecters.values()) rej(new Error("transport_closed"));
    this.rejecters.clear();
    this.resolvers.clear();
  }
  resolve(command: string, data?: unknown): void {
    this.resolvers.get(command)?.({ success: true, data });
  }
  reject(command: string, error: string): void {
    this.rejecters.get(command)?.(new Error(error));
  }
  emitEvent(frame: any): void {
    this.eventCbs.forEach((cb) => cb(frame));
  }
  emitTransport(reason: string): void {
    this.transportCbs.forEach((cb) => cb(reason));
  }
}

/** 测试装配器:fake spawn + fake(或 real)client + 回调收集 */
function makeHarness(opts: {
  realClient?: boolean;
  versionCheck?: (binary: string, expected: string, onWarn?: (i: any) => void) => Promise<any>;
  findInPath?: (name: string) => string | null;
} = {}) {
  const child = makeFakeChild();
  const fakeClient = new FakeClient();
  const states: string[] = [];
  const snapshots: unknown[] = [];
  const events: any[] = [];
  const exits: any[] = [];
  const warns: any[] = [];
  const spawnImpl = vi.fn(() => child.child);
  const rpcFactory = opts.realClient
    ? vi.fn((sendRaw: (chunk: string) => void) => new RpcClient(sendRaw))
    : vi.fn((_sendRaw: (chunk: string) => void) => fakeClient);
  const proc = new PiProcess({
    spawnImpl,
    rpcFactory,
    findInPath: opts.findInPath ?? (() => "/fake/pi"),
    versionCheck:
      opts.versionCheck ?? (async () => ({ binary: "/fake/pi", version: "0.85.1", match: true })),
  });
  proc.onState((s, snap) => {
    states.push(s);
    if (snap !== undefined) snapshots.push(snap);
  });
  proc.onEvent((f) => events.push(f));
  proc.onExit((i) => exits.push(i));
  proc.onWarn((i) => warns.push(i));
  return { proc, child, fakeClient, spawnImpl, rpcFactory, states, snapshots, events, exits, warns };
}

/** 推进微任务队列:让 doStart 走到 await client.request 的挂起点(版本预检 await 之后);不依赖假时钟 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 走完握手直达 ready */
async function startToReady(h: ReturnType<typeof makeHarness>, dataDir = "/tmp/pidesk-test") {
  const sp = h.proc.start(dataDir, "0.85.1");
  await flush(); // 等 get_state 请求已发出
  h.fakeClient.resolve("get_state", { model: "test-model" });
  return { snapshot: await sp };
}

describe("pi-process 状态机", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("① happy path:spawning→handshaking→ready,快照上抛,缓冲事件握手后按序重放", async () => {
    // 真实 RpcClient:握手响应以 JSONL 行喂入,须真实解析(与 req_1 对齐)
    const h = makeHarness({ realClient: true });
    const sp = h.proc.start("/tmp/pidesk-test", "0.85.1");
    await flush(); // 等 spawn 与 stdout/stderr 接线完成
    console.log("DBG1 states:", JSON.stringify(h.states), "writes:", JSON.stringify(h.child.stdinWrites));
    // 握手期到达的会话事件:先缓冲
    h.child.stdoutData('{"type":"agent_start"}\n');
    h.child.stdoutData('{"type":"message_update"');
    h.child.stdoutData(',"extra":1}\n'); // 跨 chunk 分帧
    expect(h.states).toEqual(["handshaking"]);
    expect(h.events).toEqual([]); // 未 ready:不透传
    // 用真实 RpcClient:喂 response 帧解析握手(id 与首个请求 req_1 对齐)
    h.child.stdoutData(
      '{"type":"response","command":"get_state","id":"req_1","success":true,"data":{"messages":[]}}\n',
    );
    const snapshot = await Promise.race([sp, new Promise((_, rej) => setTimeout(() => rej(new Error("HANG")), 1500))]);
    console.log("DBG2 snapshot:", JSON.stringify(snapshot));
    expect(snapshot).toEqual({ messages: [] });
    expect(h.states).toEqual(["handshaking", "ready"]);
    expect(h.snapshots).toEqual([{ messages: [] }]);
    // 缓冲事件在 ready 后按原序重放
    expect(h.events.map((f) => f.type)).toEqual(["agent_start", "message_update"]);
    // spawn 实参:--mode rpc + 隔离 env
    expect(h.spawnImpl).toHaveBeenCalledWith(
      "/fake/pi",
      ["--mode", "rpc"],
      expect.objectContaining({
        env: expect.objectContaining({
          PIDESK_HOST: "1",
          PI_CODING_AGENT_DIR: "/tmp/pidesk-test/pi-agent",
        }),
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    // stdin 收到过 get_state 命令
    expect(h.child.stdinWrites.join("")).toContain('"type":"get_state"');
  });

  it("② 版本不匹配:仅 onWarn 告警,不阻断,正常进 ready", async () => {
    const h = makeHarness({
      versionCheck: async (_b, _e, onWarn) => {
        onWarn?.({ binary: "/fake/pi", expected: "0.85.1", actual: "0.9.0" });
        return { binary: "/fake/pi", version: "0.9.0", match: false };
      },
    });
    await startToReady(h);
    expect(h.warns).toEqual([
      { binary: "/fake/pi", expected: "0.85.1", actual: "0.9.0" },
    ]);
    expect(h.states.at(-1)).toBe("ready");
  });

  it("③ 版本预检抛错 → crashed,start 拒绝,不 spawn", async () => {
    const h = makeHarness({
      versionCheck: async () => {
        throw new Error("pi --version 执行失败");
      },
    });
    await expect(h.proc.start("/tmp/d", "0.85.1")).rejects.toThrow(/pi --version 执行失败/);
    expect(h.states).toEqual(["crashed"]);
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });

  it("④ 二进制解析失败(未找到 pi)→ crashed,start 拒绝", async () => {
    const h = makeHarness({ findInPath: () => null });
    await expect(h.proc.start("/tmp/d", "0.85.1")).rejects.toThrow(/PIDESK_PI_PATH/);
    expect(h.states).toEqual(["crashed"]);
    expect(h.spawnImpl).not.toHaveBeenCalled();
  });

  it("⑤ spawn 失败(error 事件)→ crashed,onExit 带 spawnError,start 拒绝", async () => {
    const h = makeHarness();
    const sp = h.proc.start("/tmp/d", "0.85.1");
    await flush();
    h.child.emitError(new Error("spawn ENOENT"));
    // Node spawn 失败(ENOENT)时 error 后只补 close(无 exit):code/signal 均为 null
    h.child.emitExit(null, null);
    await expect(sp).rejects.toThrow(/启动失败/);
    expect(h.states).toEqual(["handshaking", "crashed"]);
    expect(h.exits).toHaveLength(1);
    expect(h.exits[0].spawnError).toContain("ENOENT");
    expect(h.fakeClient.closeCount).toBeGreaterThanOrEqual(1); // 崩溃时关闭客户端
  });

  it("⑥ ready 中非零退出 → crashed,onExit 带 stderr 尾部", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.child.stderrData("FATAL: model load failed\n");
    h.child.emitExit(1, null);
    expect(h.states).toEqual(["handshaking", "ready", "crashed"]);
    expect(h.exits).toHaveLength(1);
    expect(h.exits[0]).toMatchObject({ code: 1, signal: null });
    expect(h.exits[0].stderrTail).toContain("model load failed");
  });

  it("⑦ ready 中意外零退出(非宿主停机)→ stopped", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.child.emitExit(0, null);
    expect(h.states).toEqual(["handshaking", "ready", "stopped"]);
    expect(h.exits[0]).toMatchObject({ code: 0, signal: null });
  });

  it("⑧ busy 迁移:prompt/steer/follow_up 发出即 busy,agent_settled 回 ready", async () => {
    const h = makeHarness();
    await startToReady(h);
    for (const cmd of ["prompt", "steer", "follow_up"] as const) {
      const pr = h.proc.request(cmd, { text: "x" }, { timeoutMs: 1_000 }); // 请求挂起中,不 await
      expect(h.states.at(-1)).toBe("busy");
      h.fakeClient.emitEvent({ type: "agent_settled" });
      expect(h.states.at(-1)).toBe("ready");
      h.fakeClient.resolve(cmd, {}); // 收尾,防悬挂
      await pr;
    }
    // agent_settled 事件本身也透传给 onEvent
    expect(h.events.filter((f) => f.type === "agent_settled")).toHaveLength(3);
  });

  it("⑨ busy 命令请求失败 → 防御性回退 ready", async () => {
    const h = makeHarness();
    await startToReady(h);
    const pr = h.proc.request("prompt", {}, { timeoutMs: 1_000 });
    h.fakeClient.reject("prompt", "boom");
    await expect(pr).rejects.toThrow("boom");
    expect(h.states.at(-1)).toBe("ready");
  });

  it("⑩ abort:发 abort 命令进 stopping,agent_end 回 ready;agent_settled 不复位", async () => {
    const h = makeHarness();
    await startToReady(h);
    const promptPr = h.proc.request("prompt", {}, { timeoutMs: 1_000 }); // 挂起中
    const ab = h.proc.abort();
    expect(h.states.at(-1)).toBe("stopping");
    expect(h.fakeClient.requests.at(-1)!.command).toBe("abort");
    h.fakeClient.resolve("prompt", {}); // 收尾 prompt,防悬挂
    await promptPr;
    h.fakeClient.resolve("abort", {});
    await ab;
    // stopping 下 agent_settled 不触发迁移
    h.fakeClient.emitEvent({ type: "agent_settled" });
    expect(h.states.at(-1)).toBe("stopping");
    // agent_end 回 ready
    h.fakeClient.emitEvent({ type: "agent_end", messages: [] });
    expect(h.states).toEqual(["handshaking", "ready", "busy", "stopping", "ready"]);
  });

  it("⑪ 非 busy 命令(get_messages)不改变状态", async () => {
    const h = makeHarness();
    await startToReady(h);
    const p = h.proc.request("get_messages", {}, { timeoutMs: 1_000 });
    h.fakeClient.resolve("get_messages", { messages: [] });
    await p;
    expect(h.states).toEqual(["handshaking", "ready"]);
  });

  it("⑫ 非 ready/busy 态发命令抛错;重复 start 拒绝", async () => {
    const h = makeHarness();
    const sp = h.proc.start("/tmp/d", "0.85.1"); // handshaking 中
    await flush();
    expect(() => h.proc.request("prompt", {})).toThrow(/不允许发送/);
    expect(() => h.proc.abort()).toThrow(/不允许发送/);
    await expect(h.proc.start("/tmp/d", "0.85.1")).rejects.toThrow(/重复启动/);
    h.fakeClient.resolve("get_state", {});
    await sp;
  });

  it("⑬ stop() 三阶段兜底:end → 3s SIGTERM → 再 2s SIGKILL", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.proc.stop();
    expect(h.child.isEnded()).toBe(true); // 立即优雅停
    expect(h.states.at(-1)).toBe("stopped");
    expect(h.child.kills).toEqual([]);
    vi.advanceTimersByTime(3_000);
    expect(h.child.kills).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(2_000);
    expect(h.child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    // kill 后 exit 到达:保持 stopped,onExit 上抛
    h.child.emitExit(null, "SIGKILL");
    expect(h.states.at(-1)).toBe("stopped");
    expect(h.exits).toHaveLength(1);
  });

  it("⑭ stop() 后进程先退出:三阶段定时器全部清除,不再 kill", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.proc.stop();
    h.child.emitExit(0, null); // 优雅退出
    vi.advanceTimersByTime(10_000);
    expect(h.child.kills).toEqual([]);
    expect(h.states.at(-1)).toBe("stopped");
    expect(h.exits[0]).toMatchObject({ code: 0, signal: null });
  });

  it("⑮ 传输错误 protocol_broken → crashed;exit 后不重复迁移但 onExit 上抛", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.fakeClient.emitTransport("protocol_broken");
    expect(h.states).toEqual(["handshaking", "ready", "crashed"]);
    h.child.emitExit(1, null);
    expect(h.states).toHaveLength(3); // 已是 crashed,不重复迁移
    expect(h.exits).toHaveLength(1);
  });

  it("⑯ 宿主 stop() 后传输断裂不误判 crashed", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.proc.stop();
    h.fakeClient.emitTransport("transport_closed");
    expect(h.states.at(-1)).toBe("stopped");
  });

  it("⑰ stop() 在 crashed 后仍可调用:仅清理,不改状态,照常杀进程", async () => {
    const h = makeHarness();
    await startToReady(h);
    h.child.emitExit(1, null);
    expect(h.states.at(-1)).toBe("crashed");
    h.proc.stop(); // 终态:不重复迁移
    expect(h.states).toEqual(["handshaking", "ready", "crashed"]);
    expect(h.fakeClient.closeCount).toBeGreaterThanOrEqual(1);
  });

  it("⑱ 握手期退出:start 以失败收场,状态 crashed", async () => {
    const h = makeHarness();
    const sp = h.proc.start("/tmp/d", "0.85.1");
    await flush();
    h.child.emitExit(1, null); // 未握手进程即死
    await expect(sp).rejects.toThrow(/启动失败/);
    expect(h.states).toEqual(["handshaking", "crashed"]);
    expect(h.exits[0].code).toBe(1);
  });

  it("⑲ 握手响应 success:false → crashed,start 拒绝", async () => {
    const h = makeHarness();
    const sp = h.proc.start("/tmp/d", "0.85.1");
    await flush();
    h.fakeClient.reject("get_state", "no session");
    await expect(sp).rejects.toThrow(/no session/);
    expect(h.states.at(-1)).toBe("crashed");
  });
});
