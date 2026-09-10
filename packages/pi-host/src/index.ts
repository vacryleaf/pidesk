// 公共导出(T3 起逐卡补充)
export { createJsonlFramer } from "./jsonl-framing.js";
export { RpcClient, TIMEOUT_MS, NO_TIMEOUT } from "./rpc-client.js";
// 隔离 env 装配 + 数据目录 bootstrap(T5a)
export { buildPiEnv, bootstrapDataDir } from "./env.js";
export type { TransportErrorListener } from "./rpc-client.js";
// 二进制解析 + 版本预检(T5b)
export { resolvePiBinary, checkPiVersion } from "./version.js";
export type { VersionCheckResult, VersionWarnListener } from "./version.js";
// 单 pi 进程生命周期状态机(T6)
export { PiProcess } from "./pi-process.js";
export type {
  PiProcessState,
  PiProcessDeps,
  PiProcessExitInfo,
  ChildProcessLike,
  SpawnLike,
  RpcClientLike,
  RpcFactoryLike,
  VersionCheckLike,
} from "./pi-process.js";
// 多会话进程池(并发上限/空闲回收/崩溃重启退避)(T7a)
export { PiPool, MAX_SESSIONS, IDLE_RECLAIM_MS, RESTART_BACKOFF_MS, MAX_RESTART_ATTEMPTS } from "./pi-pool.js";
export type {
  PoolProcessLike,
  PoolTimer,
  PiPoolErrorInfo,
  PiPoolOptions,
} from "./pi-pool.js";
