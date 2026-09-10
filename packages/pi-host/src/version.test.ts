// version.ts 单元测试:解析序(mock env)+ 版本比对逻辑(注入 fake execFile)+ 超时路径
// 纪律:不在单测里依赖真 pi,子进程执行一律通过第 4 参 injectExec 注入 fake,
// 不 mock node:child_process(规避 vi.mock hoisting/importOriginal 展开引发的异常调用)。
import { describe, it, expect, vi } from "vitest";
import { resolvePiBinary, checkPiVersion } from "./version.js";

/** 构造 fake 执行器:记录调用实参,并以给定 stdout/err 回调 cb */
function fakeExec(stdout: string, err?: Error) {
  const fake = vi.fn(
    (_bin: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(err, stdout, "");
      return undefined;
    },
  );
  return fake;
}

describe("resolvePiBinary(解析序,mock env)", () => {
  it("① PIDESK_PI_PATH 非空→直接返回,不走 PATH 查找", () => {
    const find = vi.fn(() => "/usr/local/bin/pi");
    const bin = resolvePiBinary({ PIDESK_PI_PATH: "/opt/pi/pi" }, find);
    expect(bin).toBe("/opt/pi/pi");
    expect(find).not.toHaveBeenCalled();
  });

  it("① PIDESK_PI_PATH 为纯空白→视为未设置,继续 ②", () => {
    const bin = resolvePiBinary({ PIDESK_PI_PATH: "   " }, () => "/usr/bin/pi");
    expect(bin).toBe("/usr/bin/pi");
  });

  it("② env 无 PIDESK_PI_PATH→用 findInPath 找到的 pi", () => {
    const find = vi.fn(() => "/usr/bin/pi");
    const bin = resolvePiBinary({}, find);
    expect(bin).toBe("/usr/bin/pi");
    expect(find).toHaveBeenCalledWith("pi");
  });

  it("③ 都无→抛错,信息指引设置 PIDESK_PI_PATH", () => {
    expect(() => resolvePiBinary({}, () => null)).toThrow(/PIDESK_PI_PATH/);
  });

  it("③ findInPath 缺省(宿主未注入)→等价于未找到,抛错", () => {
    expect(() => resolvePiBinary({})).toThrow(/PIDESK_PI_PATH/);
  });
});

describe("checkPiVersion(逻辑:比对/match/onWarn,注入 fake execFile)", () => {
  it("版本一致→match=true,不触发 onWarn", async () => {
    const fake = fakeExec("0.85.1\n");
    const onWarn = vi.fn();
    const r = await checkPiVersion("/usr/local/bin/pi", "0.85.1", onWarn, fake);
    expect(r).toEqual({
      binary: "/usr/local/bin/pi",
      version: "0.85.1",
      match: true,
    });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("不匹配→match=false,触发 onWarn 且 resolve 不阻断", async () => {
    const fake = fakeExec("0.99.9\n");
    const onWarn = vi.fn();
    const r = await checkPiVersion("/usr/local/bin/pi", "0.85.1", onWarn, fake);
    expect(r.match).toBe(false);
    expect(r.version).toBe("0.99.9");
    expect(onWarn).toHaveBeenCalledWith({
      binary: "/usr/local/bin/pi",
      expected: "0.85.1",
      actual: "0.99.9",
    });
  });

  it("stdout 首尾空白被 trim", async () => {
    const fake = fakeExec("  0.85.1 \n");
    const r = await checkPiVersion("pi", "0.85.1", undefined, fake);
    expect(r.version).toBe("0.85.1");
    expect(r.match).toBe(true);
  });

  it("执行失败(退出码非 0)→ reject,不走告警", async () => {
    const fake = fakeExec("", Object.assign(new Error("Command failed"), { code: 127 }));
    const onWarn = vi.fn();
    await expect(
      checkPiVersion("pi", "0.85.1", onWarn, fake),
    ).rejects.toThrow(/执行失败/);
    expect(onWarn).not.toHaveBeenCalled();
  });

  it("超时路径(killed+SIGTERM)→ reject 且提示超时", async () => {
    const err = Object.assign(new Error("etimedout"), {
      killed: true,
      signal: "SIGTERM",
    });
    const fake = fakeExec("", err);
    await expect(
      checkPiVersion("pi", "0.85.1", undefined, fake),
    ).rejects.toThrow(/超时/);
  });

  it("execFile 收到 --version 参数与 10s 超时选项", async () => {
    const fake = fakeExec("0.85.1\n");
    await checkPiVersion("pi", "0.85.1", undefined, fake);
    expect(fake).toHaveBeenCalledWith(
      "pi",
      ["--version"],
      expect.objectContaining({ timeout: 10_000 }),
      expect.any(Function),
    );
  });
});

describe("checkPiVersion(进程失败路径:ENOENT 等价验证;真 pi 冒烟留 L2 卡)", () => {
  it("二进制不存在/不可执行(spawn ENOENT)→ reject", async () => {
    const fake = fakeExec(
      "",
      Object.assign(new Error("spawn /no/such/pi ENOENT"), { code: "ENOENT" as const }),
    );
    await expect(
      checkPiVersion("/no/such/pi", "0.85.1", undefined, fake),
    ).rejects.toThrow(/执行失败/);
  });
});
