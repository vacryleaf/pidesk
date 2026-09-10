// 协议类型字典:从 pi-coding-agent 以 type-only 方式重导出,零运行时依赖(DR-001)
// 导入方式核对:该包 exports["."].types 指向 dist/index.d.ts,以下均为其 type 级导出
export type {
  // pi 会话事件流(JSON 模式 agent 会话事件)
  JsonAgentSessionEvent,
  // RPC 模式会话状态
  RpcSessionState,
  // 注:上游无独立的 "ExtensionUIRequest" 导出,取语义最近的 RpcExtensionUIRequest
  // (出处:dist/modes/rpc/rpc-types.ts,extension 需要用户输入/确认时发出的 UI 请求)
  RpcExtensionUIRequest as ExtensionUIRequest,
  // 扩展错误
  ExtensionError,
} from "@earendil-works/pi-coding-agent";
