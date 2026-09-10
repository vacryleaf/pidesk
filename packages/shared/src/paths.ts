// 数据目录解析(pure function:零 IO,可独立测试)
// 语义:
// - <dataDir> 解析优先级:
//   ① env.PIDESK_DATA_DIR 非空 → 直接用之
//   ② 否则(纯 Node 环境/无 electron 可用)→ 默认 <仓库根>/.pidesk-dev
//   TODO(T8a):electron 打包态接 app.getPath('userData'),此处留空分支。
// - 仓库根定义:从本文件所在目录向上第一个含 pnpm-workspace.yaml 的目录。

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 开发态默认数据目录名(相对仓库根) */
export const DEV_DATA_DIR_NAME = ".pidesk-dev";

/**
 * 从给定起点(含本身)向上查找第一个含 pnpm-workspace.yaml 的目录,
 * 找不到则返回 undefined(调用方自行兜底)。
 */
function findRepoRootFrom(startDir: string): string | undefined {
  let cur = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(cur, "pnpm-workspace.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined; // 到根目录仍未找到
    cur = parent;
  }
  return undefined;
}

/**
 * 解析仓库根:从本文件位置向上找到含 pnpm-workspace.yaml 的目录;
 * 找不到时(如发布包被移出仓库结构)退回当前工作目录。
 */
export function findRepoRoot(): string {
  const fileDir = dirname(fileURLToPath(import.meta.url));
  return findRepoRootFrom(fileDir) ?? process.cwd();
}

/**
 * 解析 pidesk 数据目录(纯函数,无 IO 副作用):
 * ① PIDESK_DATA_DIR 非空 → 用之;
 * ② 否则 → <仓库根>/.pidesk-dev。
 * TODO(T8a):electron 打包态应改用 app.getPath('userData'),届时在此接入并加参数区分运行态。
 */
export function resolveDataDir(env: NodeJS.ProcessEnv): string {
  const explicit = env.PIDESK_DATA_DIR;
  if (explicit && explicit.trim() !== "") return explicit;
  return join(findRepoRoot(), DEV_DATA_DIR_NAME);
}
