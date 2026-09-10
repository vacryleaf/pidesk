// @pidesk/shared 桶导出:对外暴露 protocol/ipc/redact 的全部公开符号

// 协议类型(type-only,零运行时依赖)
export type {
  JsonAgentSessionEvent,
  RpcSessionState,
  ExtensionUIRequest,
  ExtensionError,
} from "./protocol";

// IPC 契约:通道常量 + 请求/响应/推送类型
export * from "./ipc";

// 脱敏工具
export { redact } from "./redact";
