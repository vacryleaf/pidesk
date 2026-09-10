// 公共导出(T3 起逐卡补充)
export { createJsonlFramer } from "./jsonl-framing.js";
export { RpcClient, TIMEOUT_MS, NO_TIMEOUT } from "./rpc-client.js";
// 隔离 env 装配 + 数据目录 bootstrap(T5a)
export { buildPiEnv, bootstrapDataDir } from "./env.js";
export type { TransportErrorListener } from "./rpc-client.js";
