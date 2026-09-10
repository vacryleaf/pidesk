// L2 真机集成测试(T7b):对真实 pi 0.85.1 --mode rpc 走完整闭环。
// 前提(主线程已实测,照抄勿再探索):
//   - `pi --mode rpc` stdin 发 {"type":"get_state","id":1} → stdout 回
//     {"id":1,"type":"response","command":"get_state","success":true,"data":{...}}(含 model/thinkingLevel/sessionFile)
//   - 非 JSON 输入 → {"type":"response","command":"parse","success":false,"error":"..."}(无 id)
// 纪律:每用例独立临时数据目录(env 隔离,不触 ~/.pi),afterEach 清理;
//       无 pi 二进制时整组跳过;用例 4 需 PI_L2_FULL=1 门控(避免模型依赖)。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiProcess, type PiProcessExitInfo } from "../src/pi-process.js";
import { RpcClient, TIMEOUT_MS } from "../src/rpc-client.js";
import { buildPiEnv, bootstrapDataDir } from "../src/env.js";

// ---- pi 二进制探测:PIDESK_PI_PATH 优先,其次搜 PATH(与 version.ts 解析序对齐) ----

function findPiInPath(name: string): string | null {
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const forcedPath = process.env.PIDESK_PI_PATH?.trim();
const piBinary = forcedPath && forcedPath !== "" ? forcedPath : findPiInPath("pi");
const hasPi = piBinary != null && existsSync(piBinary);

// ---- 公共夹具:独立临时数据目录 + 默认真实 spawn 的 PiProcess(注入捕获 client 与 stdin 写口) ----

let dataDir = "";
let activeProc: PiProcess | null = null;

/** 建一个接真 pi 的 PiProcess:spawn 走 PiProcess 默认真实现;rpcFactory 仅做旁路捕获,不改行为 */
function makeProc() {
  let client: RpcClient | null = null;
  let writeRaw: ((chunk: string) => void) | null = null;
  const proc = new PiProcess({
    findInPath: () => piBinary ?? null,
    rpcFactory: (sendRaw) => {
      writeRaw = sendRaw; // sendRaw 即"写 pi stdin",用例 2 直接喂非法 JSON 用
      client = new RpcClient(sendRaw);
      return client;
    },
  });
  activeProc = proc;
  return {
    proc,
    client: () => {
      if (client === null) throw new Error("RPC 客户端尚未创建(start 未调用)");
      return client;
    },
    writeRaw: () => {
      if (writeRaw === null) throw new Error("stdin 写口尚未创建(start 未调用)");
      return writeRaw;
    },
  };
}

// 每用例独立临时数据目录(env 隔离),用例内 start(dataDir) 使用
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pidesk-l2-"));
  bootstrapDataDir(dataDir); // 隔离 settings(defaultProjectTrust:never)
});

afterEach(() => {
  // 兜底:用例中途断言失败也停掉真 pi,防止悬挂进程拖死测试 runner
  if (activeProc !== null) {
    try {
      if (activeProc.state !== "stopped" && activeProc.state !== "crashed") activeProc.stop();
    } catch {
      /* 已退,忽略 */
    }
  }
  activeProc = null;
  rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!hasPi)("L2 真 pi RPC 闭环(pi 0.85.1)", () => {
  it(
    "start 握手:get_state 成功 → ready,快照含 model,会话文件隔离在临时目录",
    async () => {
      const { proc } = makeProc();
      const snapshot = (await proc.start(dataDir, "0.85.1")) as Record<string, unknown>;

      expect(proc.state).toBe("ready");
      expect(snapshot).toBeTypeOf("object");
      expect("model" in snapshot).toBe(true); // 实测:快照含 model/thinkingLevel/sessionFile
      // 隔离红线:会话文件必须落在临时数据目录内(env 隔离生效,未触 ~/.pi)
      const sessionFile = snapshot["sessionFile"];
      expect(typeof sessionFile).toBe("string");
      if (typeof sessionFile === "string" && sessionFile !== "") {
        expect(sessionFile.startsWith(dataDir)).toBe(true);
      }
    },
    20_000,
  );

  it(
    "喂非法 JSON 行:pi 回 parse 错误帧,client 计 parse,进程不崩仍 ready",
    async () => {
      const { proc, client, writeRaw } = makeProc();
      await proc.start(dataDir, "0.85.1");
      expect(client().protoErrorCount.parse).toBe(0);

      // 直接写 pi stdin(绕过 RpcClient 命令封装),模拟上游异常输入
      writeRaw()("this is definitely not json\n");

      // pi 应回 {"type":"response","command":"parse","success":false,...}(无 id)→ 仅计数
      await vi.waitFor(
        () => expect(client().protoErrorCount.parse).toBeGreaterThanOrEqual(1),
        { timeout: TIMEOUT_MS.quick, interval: 50 },
      );
      // 单帧坏输入不触发 protocol_broken(L1 阈值 5),状态机应停留在 ready
      expect(proc.state).toBe("ready");
    },
    20_000,
  );

  it(
    "stop():stdin.end 优雅退出,状态 stopped,exit 兜底三阶段未走 SIGTERM",
    async () => {
      const { proc } = makeProc();
      await proc.start(dataDir, "0.85.1");

      const exited = new Promise<PiProcessExitInfo>((resolve, reject) => {
        proc.onExit(resolve);
        setTimeout(() => reject(new Error("stop() 后 5s 内未收到 exit 事件")), 5_000);
      });
      proc.stop(); // 同步置 stopped,随后 stdin.end() 优雅停(DR-002 第一阶段)
      expect(proc.state).toBe("stopped");

      const info = await exited;
      // 优雅路径证据:pi 随 stdin EOF 自行退出(code 0、无信号),无需 SIGTERM/SIGKILL
      expect(info.code).toBe(0);
      expect(info.signal).toBeNull();
      expect(proc.state).toBe("stopped"); // 终态不被退出事件改写
    },
    20_000,
  );

  // 门控:真模型冒烟,默认跳过(需隔离目录内已配置可用模型,如 Ollama localhost:11434)
  it.skipIf(process.env.PI_L2_FULL !== "1")(
    "prompt 真模型冒烟:text_delta ≥1 → agent_settled → get_messages 含回复",
    async () => {
      const { proc } = makeProc();
      await proc.start(dataDir, "0.85.1");

      const events: any[] = [];
      proc.onEvent((frame) => events.push(frame));

      const promptRes = await proc.request(
        "prompt",
        { message: "回复 ok 两个字母以内" },
        { timeoutMs: TIMEOUT_MS.prompt },
      );
      expect(promptRes.success).toBe(true); // 仅代表已受理;流式事件异步到达

      await vi.waitFor(
        () => {
          const hasTextDelta = events.some(
            (f) => f.type === "message_update" && f.assistantMessageEvent?.type === "text_delta",
          );
          expect(hasTextDelta).toBe(true); // 至少 1 个 text_delta
          expect(events.some((f) => f.type === "agent_settled")).toBe(true); // 回合收尾
        },
        { timeout: 55_000, interval: 100 },
      );

      const msgsRes = await proc.request("get_messages", undefined, {
        timeoutMs: TIMEOUT_MS.quick,
      });
      expect(msgsRes.success).toBe(true);
      const messages =
        (msgsRes as { success: true; data?: { messages?: any[] } }).data?.messages ?? [];
      const replyText = messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) =>
          Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === "text").map((c: any) => String(c.text))
            : [],
        )
        .join("");
      expect(replyText.toLowerCase()).toContain("ok");
    },
    60_000,
  );
});
