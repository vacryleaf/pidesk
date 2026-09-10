import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcClient } from "./rpc-client.js";
import { PiProcess, type ChildProcessLike } from "./pi-process.js";

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
    stdin: { write: (c: string) => { stdinWrites.push(c); }, end: () => { stdinEnded = true; } },
    stdout: { on: (ev, cb) => on(`stdout:${ev}`, cb as Cb) },
    stderr: { on: (ev, cb) => on(`stderr:${ev}`, cb as Cb) },
    on,
    kill: (s) => { kills.push(String(s)); return true; },
  };
  const emit = (key: string, ...args: unknown[]) => (handlers.get(key) ?? []).forEach((cb) => cb(...args));
  return {
    child, stdinWrites, kills, isEnded: () => stdinEnded,
    stdoutData: (c: string) => emit("stdout:data", Buffer.from(c, "utf8")),
    stderrData: (c: string) => emit("stderr:data", Buffer.from(c, "utf8")),
    emitError: (e: Error) => emit("error", e),
    emitExit: (code: number | null, sig: string | null) => emit("exit", code, sig),
  };
}

describe("probe", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("probe ①", async () => {
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child.child);
    const rpcFactory = vi.fn((sendRaw: (c: string) => void) => new RpcClient(sendRaw));
    const proc = new PiProcess({
      spawnImpl, rpcFactory,
      findInPath: () => "/fake/pi",
      versionCheck: async () => ({ binary: "/fake/pi", version: "0.85.1", match: true }),
    });
    const sp = proc.start("/tmp/pidesk-test", "0.85.1");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    console.log("P1 stdinWrites:", JSON.stringify(child.stdinWrites));
    child.stdoutData('{"type":"agent_start"}\n');
    child.stdoutData('{"type":"message_update"');
    child.stdoutData(',"extra":1}\n');
    child.stdoutData('{"type":"response","command":"get_state","id":"req_1","success":true,"data":{"messages":[]}}\n');
    const snapshot = await Promise.race([
      sp,
      new Promise((_, rej) => setTimeout(() => rej(new Error("HANG")), 800)),
    ]);
    console.log("P2 ok:", JSON.stringify(snapshot));
    expect(snapshot).toEqual({ messages: [] });
  });
});
