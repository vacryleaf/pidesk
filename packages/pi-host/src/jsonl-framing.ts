/**
 * JSONL 分帧器:一行一个 JSON 值。
 *
 * 协议语义(上游 pi 单进程 stdio JSONL,已实测锁定):
 * - 分帧仅按 \n 切分;行尾 \r 剥离(容忍 CRLF)
 * - UTF-8 编码:跨 chunk 的多字节字符必须正确拼接
 * - 流结束时,残余残缺行作为最后一行发出(尾行可不带 \n)
 * - 禁用 Node readline:它会按 U+2028/U+2029 切行,而这些字符在 JSON 字符串内合法
 * - stdout 纯度:帧内容即协议,不做任何过滤
 *
 * 实现:显式 UTF-8 字节累积 + 边界检查,零运行时依赖。
 * (Node 的 StringDecoder 为 internal 导出,直接 import 不可得,故手动实现)
 */

/** 统计 buf 末尾由不完整 UTF-8 字符占用的字节数(1~3),这些字节需留待后续 chunk */
function utf8TailIncomplete(buf: Buffer): number {
  let i = buf.length - 1;
  // 从末尾向前,最多看 3 个字节
  let seen = 0;
  while (seen < 3 && i >= 0) {
    const b = buf[i]!;
    if ((b & 0xc0) === 0x80) {
      // 0xxxxxxx:延续字节,继续向前
      i--;
      seen++;
      continue;
    }
    // b 是首字节(或 ASCII)
    if ((b & 0x80) === 0) return 0; // ASCII:序列完整
    // 首字节决定序列长度
    const len = (b & 0xe0) === 0xe0 ? 3 : (b & 0xf0) === 0xf0 ? 4 : 0;
    const start = i; // 该序列首字节约束
    if (buf.length - start < len) return buf.length - start; // 不完整:留待后续
    return 0;
  }
  // 全为延续字节(异常,但保守处理:可能是一个被截断的序列末尾)
  return seen;
}

/** 将 buf 截断到最后一个完整字符边界处,返回可安全转为 UTF-8 字符串的前缀 */
function decodeUtf8Safe(buf: Buffer): { text: string; rest: Buffer } {
  const incomplete = utf8TailIncomplete(buf);
  if (incomplete > 0) {
    return { text: buf.subarray(0, buf.length - incomplete).toString("utf8"), rest: buf.subarray(buf.length - incomplete) };
  }
  return { text: buf.toString("utf8"), rest: EMPTY_BUF };
}

const EMPTY_BUF: Buffer<ArrayBuffer> = Buffer.alloc(0);

/**
 * 创建 JSONL 分帧器。
 * @param onLine 每收到一行(已剥离行尾 \r,未做 JSON 解析)即回调
 * @returns { push(chunk), end() } 推入数据 / 结束流
 */
export function createJsonlFramer(onLine: (line: string) => void) {
  let pending: Buffer = EMPTY_BUF; // 尚未组成完整字符的尾部字节
  let line = ""; // 当前行累积

  /** 从 line 中切出所有完整行并回调;流结束时若 emitLast 则发出残缺尾行 */
  function drain(emitLast: boolean): void {
    let nl: number;
    while ((nl = line.indexOf("\n")) !== -1) {
      onLine(stripCr(line.slice(0, nl)));
      line = line.slice(nl + 1);
    }
    if (emitLast && line !== "") {
      onLine(stripCr(line));
      line = "";
    }
  }

  return {
    /** 推入一段数据(Buffer 或 string),切出已完整的行 */
    push(chunk: Buffer | string): void {
      const bytes = typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : chunk;
      // 拼接上一次残留的不完整字节,保证跨 chunk 多字节字符正确
      const combined = pending.length > 0 ? Buffer.concat([pending, bytes]) : bytes;
      const { text, rest } = decodeUtf8Safe(combined);
      pending = rest;
      if (text !== "") {
        line += text;
        drain(false);
      }
    },
    /** 流结束:残余(残缺)数据作为最后一行发出 */
    end(): void {
      // 把残留的不完整尾部字节按 UTF-8 宽松解码(尽力还原)
      const text = pending.toString("utf8");
      pending = EMPTY_BUF;
      if (text !== "") line += text;
      drain(true);
    },
  };
}

/** 剥离单个行尾 \r(CRLF 容忍);帧内容即协议,不做其它过滤 */
function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
