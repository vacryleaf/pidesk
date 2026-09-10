// env.ts 单元测试:临时目录验证 bootstrap + buildPiEnv 纯函数
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPiEnv, bootstrapDataDir } from "./env.js";

describe("buildPiEnv(纯函数)", () => {
  const dataDir = "/tmp/pidesk-test-data";
  it("返回恰好 4 项 env 键值正确", () => {
    const env = buildPiEnv(dataDir);
    expect(env).toEqual({
      PI_CODING_AGENT_DIR: join(dataDir, "pi-agent"),
      PI_CODING_AGENT_SESSION_DIR: join(dataDir, "pi-agent", "sessions"),
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      PIDESK_HOST: "1",
    });
  });

  it("不同 dataDir 产出不同 env(无共享状态)", () => {
    const envA = buildPiEnv("/tmp/a");
    const envB = buildPiEnv("/tmp/b");
    expect(envA.PI_CODING_AGENT_DIR).not.toBe(envB.PI_CODING_AGENT_DIR);
  });
});

describe("bootstrapDataDir(临时目录)", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "pidesk-env-"));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("幂等:两次调用结果一致(目录+settings)", () => {
    const d1 = join(tmp, "d1");
    bootstrapDataDir(d1);
    const state1 = {
      sessionsDir: existsSync(join(d1, "pi-agent", "sessions")),
      settings: readFileSync(join(d1, "pi-agent", "settings.json"), "utf8"),
    };
    // 第二次调用不应报错(幂等)
    bootstrapDataDir(d1);
    const state2 = {
      sessionsDir: existsSync(join(d1, "pi-agent", "sessions")),
      settings: readFileSync(join(d1, "pi-agent", "settings.json"), "utf8"),
    };
    expect(state1).toEqual(state2);
    expect(state1.sessionsDir).toBe(true);
  });

  it("settings.json 内容为 {\"defaultProjectTrust\":\"never\"}", () => {
    const d2 = join(tmp, "d2");
    bootstrapDataDir(d2);
    const content = readFileSync(join(d2, "pi-agent", "settings.json"), "utf8");
    expect(JSON.parse(content)).toEqual({ defaultProjectTrust: "never" });
  });

  it("已存在 settings.json 不被覆盖(保留原内容)", () => {
    const d3 = join(tmp, "d3");
    bootstrapDataDir(d3);
    const custom = JSON.stringify({ defaultProjectTrust: "custom" });
    // 模拟已存在且内容不同的 settings
    writeFileSync(join(d3, "pi-agent", "settings.json"), custom, "utf8");
    bootstrapDataDir(d3); // 不应覆盖
    const content = readFileSync(join(d3, "pi-agent", "settings.json"), "utf8");
    expect(JSON.parse(content)).toEqual({ defaultProjectTrust: "custom" });
  });
});
