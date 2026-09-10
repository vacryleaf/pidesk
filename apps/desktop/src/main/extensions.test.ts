// M2 flow-bridge 测试:写入/幂等/自动建目录。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapExtensions } from "./extensions";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pidesk-extensions-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("bootstrapExtensions", () => {
  it("写入 flow-bridge.ts 且包含 flow_emit", () => {
    bootstrapExtensions(dataDir);
    const target = join(dataDir, "pi-agent", "extensions", "flow-bridge.ts");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("flow_emit");
  });

  it("重复调用不覆盖已有文件", () => {
    bootstrapExtensions(dataDir);
    const target = join(dataDir, "pi-agent", "extensions", "flow-bridge.ts");
    const modified = "// user modified\n";
    writeFileSync(target, modified, "utf8");
    bootstrapExtensions(dataDir);
    expect(readFileSync(target, "utf8")).toBe(modified);
  });

  it("目录不存在时自动创建", () => {
    expect(existsSync(join(dataDir, "pi-agent"))).toBe(false);
    bootstrapExtensions(dataDir);
    expect(
      existsSync(join(dataDir, "pi-agent", "extensions", "flow-bridge.ts")),
    ).toBe(true);
  });
});
