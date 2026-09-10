/**
 * RPC 客户端:在 JSONL 分帧之上,实现与上游 pi --mode rpc 的请求/响应关联。
 *
 * 协议语义(上游 pi 单进程 stdio JSONL,已实测锁定):
 * - 客户端经 send_raw 向 pi stdin 写一行 JSON 命令(可带 id=req_<自增>);
 * - pi 在 stdout 回帧,按 type 分派:
 *   - type:"response"(带 command 与 id 回带)→ Promise 关联;
 *   - type:"extension_ui_request" / "extension_error" → 独立监听器;
 *   - 其余全部为会话事件 → onEvent 透传;
 * - 乱序容忍:prompt 的响应仅在 preflight 成功后回(可能晚于首批事件),
 *   因此 id 关联是唯一正确方式,禁止假设"下一个 response 属于该命令";
 * - 响应 success:true+data 或 success:false+error;
 *   解析失败回 command:"parse"(无 id);未知命令回 error "Unknown command: <type>"。
 *
 * 实现:零运行时依赖;帧由宿主喂入(每个完整一行调用 handleLine)。
 */

/** 超时分级常量(集中导出,供宿主按命令选择) */
export const TIMEOUT_MS = {
  quick: 5_000,
  prompt: 30_000,
  compact: 120_000,
} as const;

/** 不设超时的命令集合:靠宿主 abort 兜底,永不超时 */
export const NO_TIMEOUT = new Set(["bash", "export_html"]);

/** 传输层错误回调类型(如 stdin 断裂、protocol_broken) */
export type TransportErrorListener = (reason: string) => void;

/** 待关联的在途请求记录 */
interface PendingRequest {
  resolve: (v: { success: true; data?: unknown }) => void;
  reject: (reason: string) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** 连续非合法 JSON 帧达到该阈值 → 触发 onTransportError("protocol_broken") */
const BAD_LINE_THRESHOLD = 5;

/** JSON 帧最小形状:仅声明分派所需字段,其余字段以索引签名透传(替代 any) */
export interface RpcFrame {
  type?: string;
  id?: string;
  command?: string;
  success?: boolean;
  error?: string;
  data?: unknown;
  [key: string]: unknown;
}

export class RpcClient {
  private pending = new Map<string, PendingRequest>();
  private seq = 0;
  private badLineStreak = 0;
  private closed = false;
  /** 协议级错误计数:解析失败帧 / 未知命令帧 */
  readonly protoErrorCount = { parse: 0, unknownCommand: 0 };

  private eventCbs: Array<(frame: RpcFrame) => void> = [];
  private extUiCbs: Array<(frame: RpcFrame) => void> = [];
  private extErrCbs: Array<(frame: RpcFrame) => void> = [];
  private transportErrCbs: Array<TransportErrorListener> = [];

  /**
   * @param sendRaw 写口:向 pi stdin 写一段字符串(宿主通常按 JSONL 追加 \n)
   */
  constructor(private readonly sendRaw: (chunk: string) => void) {}

  /**
   * 发起一条命令请求。
   * @param command 命令名(如 "prompt")
   * @param args    命令参数(可选)
   * @param opts    timeoutMs 显式超时;不传时:命令在 NO_TIMEOUT 集合内永不超时,
   *                否则用 TIMEOUT_MS.prompt 作为默认
   * @rejects error.message 为协议 error 串 / "timeout" / "transport_closed"
   */
  request(
    command: string,
    args?: object,
    opts?: { timeoutMs?: number },
  ): Promise<{ success: true; data?: unknown } | { success: false; error: string }> {
    if (this.closed) return Promise.reject(new Error("transport_closed"));
    const id = `req_${++this.seq}`;
    const timeoutMs = opts?.timeoutMs ?? (NO_TIMEOUT.has(command) ? null : TIMEOUT_MS.prompt);

    const p = new Promise<
      { success: true; data?: unknown } | { success: false; error: string }
    >((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as { success: true; data?: unknown }),
        reject: (r) => reject(new Error(r)),
        timer: null,
      });
    });

    const pend = this.pending.get(id)!;
    if (timeoutMs !== null) {
      pend.timer = setTimeout(() => this.dropPending(id, "timeout"), timeoutMs);
    }

    // 写一行 JSON 命令;发送失败(传输断裂)直接判败
    try {
      this.sendRaw(JSON.stringify({ type: command, id, ...(args ?? {}) }) + "\n");
    } catch {
      this.dropPending(id, "transport_closed");
    }
    return p;
  }

  /** 宿主把 stdout 每个完整行(未 JSON 解析)喂入 */
  handleLine(line: string): void {
    if (this.closed) return;
    const raw = line.trim();
    if (raw === "") return; // 空行不计入坏帧统计

    let frame: RpcFrame;
    try {
      frame = JSON.parse(raw);
    } catch {
      // 连续 5 帧非合法 JSON → 协议损坏(L1 传输错误)
      if (++this.badLineStreak >= BAD_LINE_THRESHOLD) {
        this.emitTransportError("protocol_broken");
      }
      return;
    }
    this.badLineStreak = 0;
    this.dispatch(frame);
  }

  /** 流结束/传输断裂:清理全部在途请求 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.dropPending(id, "transport_closed");
    // 宿主可经 onTransportError 感知;此处主动通知
    this.emitTransportError("transport_closed");
  }

  // ---- 事件接口(可多次注册) ----

  /** 全部非 response/extension_* 的帧(会话事件),按收到顺序透传 */
  onEvent(cb: (frame: RpcFrame) => void): void {
    this.eventCbs.push(cb);
  }
  onExtensionUIRequest(cb: (frame: RpcFrame) => void): void {
    this.extUiCbs.push(cb);
  }
  onExtensionError(cb: (frame: RpcFrame) => void): void {
    this.extErrCbs.push(cb);
  }
  onTransportError(cb: TransportErrorListener): void {
    this.transportErrCbs.push(cb);
  }

  // ---- 内部 ----

  /** 按 type 分派合法 JSON 帧 */
  private dispatch(frame: RpcFrame): void {
    if (frame === null || typeof frame !== "object") return;
    const type = frame.type;
    switch (type) {
      case "response": {
        // id 回带关联;command:"parse" 的帧无 id,只计数
        if (frame.command === "parse" || frame.id === undefined) {
          this.protoErrorCount.parse++;
          return;
        }
        const pend = this.pending.get(frame.id);
        if (!pend) return; // 未知/过期 id:容忍,忽略
        this.pending.delete(frame.id);
        if (pend.timer !== null) clearTimeout(pend.timer);
        if (frame.success === true) {
          pend.resolve({ success: true, data: frame.data });
        } else {
          // success:false → 协议错误(含 "Unknown command: xxx")
          if (typeof frame.error === "string" && frame.error.startsWith("Unknown command:")) {
            this.protoErrorCount.unknownCommand++;
          }
          pend.reject(frame.error ?? "unknown protocol error");
        }
        return;
      }
      case "extension_ui_request":
        this.extUiCbs.forEach((cb) => cb(frame));
        return;
      case "extension_error":
        this.extErrCbs.forEach((cb) => cb(frame));
        return;
      default:
        // 其余全部为会话事件,透传
        this.eventCbs.forEach((cb) => cb(frame));
    }
  }

  /** 移除在途请求并回调(reason:timeout/transport_closed) */
  private dropPending(id: string, reason: string): void {
    const pend = this.pending.get(id);
    if (!pend) return;
    this.pending.delete(id);
    if (pend.timer !== null) clearTimeout(pend.timer);
    pend.reject(reason);
  }

  private emitTransportError(reason: string): void {
    this.transportErrCbs.forEach((cb) => cb(reason));
  }
}
