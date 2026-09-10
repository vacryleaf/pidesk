import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RpcClient, TIMEOUT_MS, NO_TIMEOUT, type RpcFrame } from "./rpc-client.js";

/**
 * 内存双工 mock:
 * - sent 收集客户端写向 pi stdin 的每一段
 * - feedClient(chunk) 模拟宿主分帧器把 chunk 切成完整行后喂给 client.handleLine
 * 无需真进程。
 */
function makeMock() {
  const sent: string[] = [];
  let client: RpcClient | null = null;
  let buf = "";
  const mock = {
    sendRaw: (chunk: string) => {
      sent.push(chunk);
    },
    /** 从写入内容中解析出 id 表(command → id) */
    sentIds(): Record<string, string> {
      const m: Record<string, string> = {};
      for (const s of sent) {
        try {
          const o = JSON.parse(s.trim());
          if (o.type && o.id) m[o.type] = o.id;
        } catch {
          // 忽略
        }
      }
      return m;
    },
    /** 模拟 stdout 流入:按 \n 切完整行喂给 client */
    feed(chunk: string) {
      if (!client) throw new Error("未初始化");
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        client.handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    },
    newClient() {
      client = new RpcClient(mock.sendRaw);
      return client;
    },
  };
  return mock;
}

describe("rpc-client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("① id 关联成功:两个在途请求按各自 id 收响应,乱序返回", async () => {
    const m = makeMock();
    const c = m.newClient();
    const p1 = c.request("cmdA", { x: 1 }, { timeoutMs: 1_000 });
    const p2 = c.request("cmdB", { y: 2 }, { timeoutMs: 1_000 });
    const ids = m.sentIds();
    expect(ids.cmdA).toMatch(/^req_\d+$/);
    expect(ids.cmdA).not.toBe(ids.cmdB);
    // 乱序:先回 cmdB,再回 cmdA
    m.feed(JSON.stringify({ type: "response", command: "cmdB", id: ids.cmdB, success: true, data: "b" }) + "\n");
    m.feed(JSON.stringify({ type: "response", command: "cmdA", id: ids.cmdA, success: true, data: 42 }) + "\n");
    await expect(p2).resolves.toMatchObject({ success: true, data: "b" });
    await expect(p1).resolves.toMatchObject({ success: true, data: 42 });
  });

  it("② success:false → reject(含 Unknown command 计数)", async () => {
    const m = makeMock();
    const c = m.newClient();
    const p = c.request("nope", undefined, { timeoutMs: 1_000 });
    const id = m.sentIds().nope;
    m.feed(JSON.stringify({ type: "response", command: "nope", id, success: false, error: "Unknown command: nope" }) + "\n");
    await expect(p).rejects.toThrow("Unknown command: nope");
    expect(c.protoErrorCount.unknownCommand).toBe(1);
    // 普通 success:false
    const p2 = c.request("cmdC", undefined, { timeoutMs: 1_000 });
    const id2 = m.sentIds().cmdC;
    m.feed(JSON.stringify({ type: "response", command: "cmdC", id: id2, success: false, error: "boom" }) + "\n");
    await expect(p2).rejects.toThrow("boom");
    expect(c.protoErrorCount.unknownCommand).toBe(1); // 非 Unknown 命令不计数
  });

  it("③ 超时 reject(fast-forward timers);NO_TIMEOUT 命令永不超时", async () => {
    const m = makeMock();
    const c = m.newClient();
    const p = c.request("cmdT", undefined, { timeoutMs: TIMEOUT_MS.quick });
    vi.advanceTimersByTime(TIMEOUT_MS.quick + 1);
    await expect(p).rejects.toThrow("timeout");

    // bash 在 NO_TIMEOUT 内:不传 timeoutMs 时 10 分钟也不超时
    expect(NO_TIMEOUT.has("bash")).toBe(true);
    const pBash = c.request("bash", { cmd: "ls" });
    vi.advanceTimersByTime(10 * 60_000);
    // 未 reject:用 then 探针验证仍处于 pending
    let settled = false;
    pBash.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    // 补一个响应收尾
    m.feed(JSON.stringify({ type: "response", command: "bash", id: m.sentIds().bash, success: true, data: "ok" }) + "\n");
    await expect(pBash).resolves.toMatchObject({ success: true });
  });

  it("④ 'parse' 无 id 帧计入 parse 错误,不崩溃", () => {
    const m = makeMock();
    const c = m.newClient();
    c.onTransportError(() => {});
    m.feed(JSON.stringify({ type: "response", command: "parse", error: "invalid json" }) + "\n");
    m.feed(JSON.stringify({ type: "response", command: "parse" }) + "\n");
    expect(c.protoErrorCount.parse).toBe(2);
  });

  it("⑤ 事件先于响应到达不干扰关联(prompt 乱序容忍)", async () => {
    const m = makeMock();
    const c = m.newClient();
    const events: RpcFrame[] = [];
    c.onEvent((f) => events.push(f));
    const p = c.request("prompt", { text: "hi" }, { timeoutMs: TIMEOUT_MS.prompt });
    const id = m.sentIds().prompt;
    // 首批事件先于响应到达
    m.feed(JSON.stringify({ type: "message_start", seq: 1 }) + "\n");
    m.feed(JSON.stringify({ type: "tool_call", name: "read" }) + "\n");
    m.feed(JSON.stringify({ type: "response", command: "prompt", id, success: true, data: { reply: "你好" } }) + "\n");
    m.feed(JSON.stringify({ type: "message_end", seq: 2 }) + "\n"); // 响应之后的事件也不干扰
    await expect(p).resolves.toMatchObject({ success: true, data: { reply: "你好" } });
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["message_start", "tool_call", "message_end"]);
  });

  it("⑥ 连续 5 行坏帧触发 protocol_broken;4 行不触发;合法帧重置计数", () => {
    const m = makeMock();
    const c = m.newClient();
    const errs: string[] = [];
    c.onTransportError((r) => errs.push(r));
    for (let i = 0; i < 4; i++) m.feed("not-json" + "\n");
    expect(errs).toHaveLength(0);
    m.feed(JSON.stringify({ type: "evt" }) + "\n"); // 合法帧重置连续计数
    for (let i = 0; i < 5; i++) m.feed("{broken" + "\n");
    expect(errs).toEqual(["protocol_broken"]);
  });

  it("⑦ close 后 pending 全 reject(transport_closed)", async () => {
    const m = makeMock();
    const c = m.newClient();
    const errs: string[] = [];
    c.onTransportError((r) => errs.push(r));
    const p1 = c.request("a", undefined, { timeoutMs: 60_000 });
    const p2 = c.request("b", undefined, { timeoutMs: 60_000 });
    const pNoT = c.request("bash", { cmd: "long" }); // NO_TIMEOUT 无定时器
    c.close();
    await expect(p1).rejects.toThrow("transport_closed");
    await expect(p2).rejects.toThrow("transport_closed");
    await expect(pNoT).rejects.toThrow("transport_closed");
    // close 后新请求直接拒绝
    await expect(c.request("a", undefined, { timeoutMs: 1000 })).rejects.toThrow("transport_closed");
    expect(errs).toContain("transport_closed");
    // 超时定时器应已清除:推进时间不再产生多余 reject(close 后帧被忽略)
    m.feed(JSON.stringify({ type: "event_x" }) + "\n");
  });
});
