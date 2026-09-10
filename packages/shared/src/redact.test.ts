// redact.ts 单元测试
import { describe, it, expect } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("嵌套 JSON:任意深度命中敏感键,非敏感键保留", () => {
    const input = JSON.stringify({
      apiKey: "AK-123",
      nested: { password: "p@ss", list: [{ token: "abc" }] },
      name: "ok",
    });
    expect(redact(input)).toBe(
      JSON.stringify({ apiKey: "***", nested: { password: "***", list: [{ token: "***" }] }, name: "ok" })
    );
  });

  it("JSON 字符串值里嵌套的 JSON 也命中", () => {
    const inner = JSON.stringify({ secret: "s1", user: "u" });
    const input = JSON.stringify({ config: inner, note: "hi" });
    expect(redact(input)).toBe(JSON.stringify({ config: JSON.stringify({ secret: "***", user: "u" }), note: "hi" }));
  });

  it("URL query 中 key/token/secret/apiKey 参数值替换", () => {
    const url = 'GET "https://api.example.com/v1?apiKey=abc123&token=tok9999&secret=ss777&debug=1"';
    expect(redact(url)).toContain("?apiKey=***");
    expect(redact(url)).toContain("&token=***");
    expect(redact(url)).toContain("&secret=***");
    expect(redact(url)).toContain("&debug=1");
  });

  it("Bearer/Basic 头凭证替换", () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toBe(
      'Authorization: Bearer ***'
    );
    expect(redact("curl -H 'Basic dXzlcjpwYXNz'")).toBe("curl -H 'Basic ***'");
  });

  it("sk- 开头且总长 >= 8 的令牌替换,短于 8 不变", () => {
    expect(redact("key: sk-abcdef123")).toBe("key: ***");
    // sk- 总共 6 字符(< 8)保留
    expect(redact("short: sk-ab")).toBe("short: sk-ab");
  });

  it("无敏感内容原样返回", () => {
    const safe = 'hello, name: "alice", note: "sk-?" not a token, url?x=1';
    expect(redact(safe)).toBe(safe);
  });
});
