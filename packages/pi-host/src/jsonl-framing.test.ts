import { describe, it, expect } from "vitest";
import { createJsonlFramer } from "./jsonl-framing.js";

/** 构造分帧器并收集所有行 */
function collect() {
  const lines: string[] = [];
  const framer = createJsonlFramer((l) => lines.push(l));
  return { lines, framer };
}

describe("jsonl-framing", () => {
  it("① 单帧多行:一次 push 含多个 \\n,应切出多行", () => {
    const { lines, framer } = collect();
    const data = JSON.stringify({ id: 1 }) + "\n" + JSON.stringify({ id: 2 }) + "\n" + JSON.stringify({ id: 3 }) + "\n";
    framer.push(Buffer.from(data, "utf8"));
    framer.end();
    expect(lines).toEqual([JSON.stringify({ id: 1 }), JSON.stringify({ id: 2 }), JSON.stringify({ id: 3 })]);
  });

  it("② 跨 chunk 切断多字节字符:中文/emoji 被拆在两个 chunk", () => {
    const data = JSON.stringify({ text: "中" }) + "\n" + JSON.stringify({ emoji: "😀" }) + "\n";
    const bytes = Buffer.from(data, "utf8");
    // "中" 为 3 字节:在它的中间(第 1 字节处)切断,验证 StringDecoder 拼接
    const zhIdx = bytes.indexOf(Buffer.from("中", "utf8"));
    const { lines, framer } = collect();
    framer.push(bytes.subarray(0, zhIdx + 1)); // "中" 的前 2 字节 + 后续内容拆到下一 chunk
    framer.push(bytes.subarray(zhIdx + 1));
    framer.end();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).text).toBe("中");
    expect(JSON.parse(lines[1]).emoji).toBe("😀");
  });

  it("③ CRLF 行尾:行尾 \\r 被剥离", () => {
    const { lines, framer } = collect();
    framer.push(Buffer.from('{"a":1}\r\n{"b":2}\r\n'));
    framer.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("④ 含 U+2028 / U+2029 的字符串行不被切坏", () => {
    const { lines, framer } = collect();
    const s1 = JSON.stringify({ sep: "line1\u2028line2" }); // 字符串内含 U+2028
    const s2 = JSON.stringify({ sep: "a\u2029b" });          // 字符串内含 U+2029
    framer.push(Buffer.from(s1 + "\n" + s2 + "\n"));
    framer.end();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).sep).toBe("line1\u2028line2");
    expect(JSON.parse(lines[1]).sep).toBe("a\u2029b");
  });

  it("⑤ 无尾换行的尾行:end 时作为最后一行发出", () => {
    const { lines, framer } = collect();
    framer.push(Buffer.from('{"a":1}\n{"b":2}'));
    framer.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("⑥ 半行后接续帧:首 chunk 只到半行,次 chunk 补齐并发出后续帧", () => {
    const full = Buffer.from('{"c":3}\n{"d":4}\n', "utf8");
    const nlIdx = full.indexOf(0x0a); // 第一个换行位置
    const { lines, framer } = collect();
    framer.push(full.subarray(0, nlIdx - 3)); // 半行(截在第一个 JSON 值中间)
    expect(lines).toEqual([]);               // 尚无完整行
    framer.push(full.subarray(nlIdx - 3));   // 补齐第一行 + 第二帧
    framer.end();
    expect(lines).toEqual(['{"c":3}', '{"d":4}']);
  });

  it("⑦ 空行(连续 \\n\\n)容忍", () => {
    const { lines, framer } = collect();
    framer.push(Buffer.from('{"a":1}\n\n{"b":2}\n'));
    framer.end();
    expect(lines).toEqual(['{"a":1}', '', '{"b":2}']);
  });

  it("string chunk 与 Buffer chunk 混合推入", () => {
    const { lines, framer } = collect();
    framer.push('{"a":1}\n');
    framer.push(Buffer.from('{"b":2}\n', "utf8"));
    framer.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("空流 end 幂等,无输出", () => {
    const { lines, framer } = collect();
    framer.end();
    framer.end();
    expect(lines).toEqual([]);
  });

  it("跨 chunk 的不完整多字节残留在 push 期间不产生残缺行", () => {
    const b = Buffer.from('{"x":"' + "中" + '"}\n', "utf8");
    const zhIdx = b.indexOf(Buffer.from("中", "utf8"));
    const mid = zhIdx + 2; // "中" = 3 字节,此处切剩 1 字节留到下一 chunk
    const { lines, framer } = collect();
    framer.push(b.subarray(0, mid));
    expect(lines).toEqual([]); // 尚无完整行,且不因残字节出错
    framer.push(b.subarray(mid));
    framer.end();
    expect(JSON.parse(lines[0])).toEqual({ x: "中" });
  });
});
