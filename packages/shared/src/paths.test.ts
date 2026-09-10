// paths.ts 单元测试(纯函数 + findRepoRoot 冒烟,无外部 IO)
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir, findRepoRoot, DEV_DATA_DIR_NAME } from "./paths.js";

describe("resolveDataDir", () => {
  it("① PIDESK_DATA_DIR 非空时优先使用", () => {
    const custom = "/tmp/pidesk-custom";
    expect(resolveDataDir({ PIDESK_DATA_DIR: custom })).toBe(custom);
  });

  it("② PIDESK_DATA_DIR 为空/空白/未设时回退 <仓库根>/.pidesk-dev", () => {
    const expected = join(findRepoRoot(), DEV_DATA_DIR_NAME);
    expect(resolveDataDir({})).toBe(expected);
    expect(resolveDataDir({ PIDESK_DATA_DIR: "   " })).toBe(expected);
  });

  it("回退路径与 findRepoRoot 一致性:join(repoRoot, .pidesk-dev)", () => {
    const dataDir = resolveDataDir({});
    expect(dataDir.endsWith(DEV_DATA_DIR_NAME)).toBe(true);
  });
});

describe("findRepoRoot", () => {
  it("返回含 pnpm-workspace.yaml 的目录(向上搜索命中的仓库根)", () => {
    const root = findRepoRoot();
    expect(existsSync(join(root, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("仓库根目录下存在 packages/ 与 apps/ 子目录(mono-repo 结构)", () => {
    const root = findRepoRoot();
    expect(existsSync(join(root, "packages"))).toBe(true);
    expect(existsSync(join(root, "apps"))).toBe(true);
  });
});
