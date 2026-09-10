// pi 子进程隔离 env 装配 + 数据目录 bootstrap
// 语义(已定版):
// - 隔离是双向总开关:pi 子进程只看 <dataDir>/pi-agent,永不触 ~/.pi。
// - buildPiEnv 纯函数(零 IO):装配 4 项 env。
// - bootstrapDataDir 有 IO:建目录 + 原子写 settings(幂等,已存在则不覆盖)。

import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * 装配 pi 子进程隔离 env(纯函数,无 IO 副作用)。
 * 四个键:
 *  - PI_CODING_AGENT_DIR        = <dataDir>/pi-agent
 *  - PI_CODING_AGENT_SESSION_DIR = <dataDir>/pi-agent/sessions
 *  - HTTP_PROXY / HTTPS_PROXY    预留空值占位(结构在,值暂空)
 *  - PIDESK_HOST = 1
 */
export function buildPiEnv(dataDir: string, extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const agentDir = join(dataDir, "pi-agent");
  return {
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    PIDESK_HOST: "1",
    ...extraEnv,
  };
}

/** settings.json 内容(defaultProjectTrust 必须显式,防劫持:F6) */
const SETTINGS_CONTENT = JSON.stringify({ defaultProjectTrust: "never" });

/**
 * bootstrap 数据目录(幂等):
 * 1. 确保 <dataDir>/pi-agent/sessions 目录存在(mkdirSync recursive)
 * 2. 原子写(tmp+rename)<dataDir>/pi-agent/settings.json,
 *    内容 {"defaultProjectTrust":"never"};已存在则不覆盖。
 */
export function bootstrapDataDir(dataDir: string): void {
  const sessionsDir = join(dataDir, "pi-agent", "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const settingsPath = join(dataDir, "pi-agent", "settings.json");
  if (existsSync(settingsPath)) return; // 已存在则不覆盖

  // 原子写:先写临时文件再 rename,保证 settings.json 不会处于半写状态
  const tmpPath = join(dirname(settingsPath), `.settings.json.tmp.${process.pid}`);
  writeFileSync(tmpPath, SETTINGS_CONTENT, "utf8");
  renameSync(tmpPath, settingsPath);
}
