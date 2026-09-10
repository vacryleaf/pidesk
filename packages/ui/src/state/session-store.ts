/**
 * session-store(T10a)—— renderer 会话状态机纯逻辑。
 *
 * 定位:context + reducer,不引状态库(见 m1-design §6)。
 * 本文件只放纯逻辑与 context 定义;Provider 组件与 useSessions 钩子在
 * ./store-context.tsx(.ts 不支持 JSX),保持「纯逻辑可单测」。
 *
 * 事件来源:window.pidesk.onSessionEvent 推送的 pi 会话事件
 * (shared/ipc.ts 的 JsonAgentSessionEvent)。ui 包不依赖 shared / pi 类型,
 * 故此处按「结构兼容的最小形状」声明 SessionEvent:type 为 string、其余字段可选。
 * 好处:上游新增未处理事件(compaction_* / retry_* 等)天然可赋值、reducer 直接忽略。
 */
import { createContext, type Dispatch } from "react";
import type { MessageView, ToolView } from "../components/message-list";

/** pi 进程生命周期状态(对齐 shared/ipc.ts 的 PideskProcessState) */
export type PideskProcessState =
  | "spawning"
  | "handshaking"
  | "ready"
  | "busy"
  | "stopping"
  | "crashed"
  | "stopped";

/** 上游 Usage(pi-ai)的结构最小形状:总 token 由 totalTokens 给出(单条消息累计值) */
export type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
};

/** message_update 内嵌的增量事件(assistantMessageEvent)的最小形状 */
export type AssistantMessageEventLike = {
  type: string;
  contentIndex?: number;
  /** text_delta / thinking_delta / toolcall_delta 的增量文本 */
  delta?: string;
  /** toolcall_start 上游补出的 id 与工具名 */
  id?: string;
  toolName?: string;
  /** toolcall_end 的完整工具调用 */
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
};

/** 上游 AgentMessage 的结构最小形状(只取本层需要的字段) */
export type AgentMessageLike = {
  role?: string;
  content?: unknown;
  usage?: UsageLike;
};

/**
 * 会话事件:结构兼容 pi 的 JsonAgentSessionEvent,字段全可选便于单测构造字面量。
 * 兼容两种到达形态:① 顶层拍平(text_delta / toolcall_start ...);
 * ② message_update 内嵌 assistantMessageEvent(JSON/RPC 协议的实际形态)。
 */
export type SessionEvent = {
  type: string;
  // 顶层增量
  delta?: string;
  // message_update
  usage?: UsageLike;
  assistantMessageEvent?: AssistantMessageEventLike;
  message?: AgentMessageLike;
  // toolcall_* / tool_execution_*
  id?: string;
  toolName?: string;
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> };
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
  // queue_update
  steering?: readonly string[];
  followUp?: readonly string[];
  // session_info_changed
  name?: string;
};

/**
 * 会话内工具行:复用 message-list 的 ToolView,额外挂两个内部簿记字段。
 * ToolView 本身无 id,同一消息内多个同名工具调用需靠 toolCallId 区分。
 */
export type SessionToolView = ToolView & {
  /** 上游 toolCallId(缺省时退化为 toolName 匹配) */
  toolCallId?: string;
  /** 工具开始时间(ms):tool_execution_end 据此算 durationMs */
  startedAtMs?: number;
};

/** 会话内消息:复用 MessageView,仅把 tools 细化为带 toolCallId 的会话形状 */
export type SessionMessageView = Omit<MessageView, "tools"> & { tools?: SessionToolView[] };

/** 扩展 UI 请求种类(对齐 pi 的 extension_ui_request:confirm/select/input) */
export type UiRequestKind = "confirm" | "select" | "input";

/** 扩展 UI 请求视图(结构最小形状):id 用于答复定位,summary 为风险/提示摘要 */
export type UiRequestView = {
  /** 上游请求 id */
  id: string;
  kind: UiRequestKind;
  /** 风险摘要 / 提示文本(供审批条与后续呈现) */
  summary: string;
};

/** 崩溃态默认错误文案(横幅展示,main 侧可经 message 覆盖) */
export const CRASHED_ERROR = "pi 进程异常退出";

/** 单个会话状态 */
export type SessionState = {
  id: string;
  label: string;
  messages: SessionMessageView[];
  /** 回合进行中(agent_start → agent_settled) */
  sending: boolean;
  processState: PideskProcessState;
  /** 队列提示计数(steering/followUp,来自 queue_update) */
  queueCounts: { steering: number; followUp: number };
  /** 待答复的扩展 UI 请求队列(extension_ui_request,FIFO;呈现留 T11 联调卡) */
  uiRequests: UiRequestView[];
  /** 会话落盘文件(main 侧注入,本层仅透传占位) */
  sessionFile?: string;
  /** 错误信息(SESSION_ERROR,或崩溃态默认文案) */
  error?: string;
  /** 内部簿记:当前流式中的助手消息 id(message_end / agent_settled 后清空) */
  streamingMessageId?: string;
};

/** reducer 动作 */
export type SessionAction =
  | { type: "SESSION_CREATED"; id: string }
  | { type: "SESSION_REMOVED"; id: string }
  | { type: "SESSION_SET_STATE"; id: string; processState: PideskProcessState; message?: string }
  | { type: "SESSION_ERROR"; id: string; message: string }
  | { type: "UI_REQUEST_QUEUED"; id: string; request: UiRequestView }
  | { type: "UI_REQUEST_RESOLVED"; id: string; requestId: string }
  | { type: "EVENT"; sessionId: string; event: SessionEvent };

/** store 根状态:有序会话集合 */
export type SessionStoreState = { sessions: SessionState[] };

export const initialSessionStore: SessionStoreState = { sessions: [] };

/** 新建会话的默认态 */
function createSession(id: string): SessionState {
  return {
    id,
    label: id,
    messages: [],
    sending: false,
    processState: "spawning",
    queueCounts: { steering: 0, followUp: 0 },
    uiRequests: [],
  };
}

/** 按键名定位会话并替换;未命中或未变化时原样返回(保持引用相等,减少重渲) */
function updateSession(
  state: SessionStoreState,
  id: string,
  updater: (session: SessionState) => SessionState,
): SessionStoreState {
  let changed = false;
  const sessions = state.sessions.map((session) => {
    if (session.id !== id) return session;
    const next = updater(session);
    if (next !== session) changed = true;
    return next;
  });
  return changed ? { sessions } : state;
}

/** 选择器:按 id 取会话 */
export function selectSession(state: SessionStoreState, id: string): SessionState | undefined {
  return state.sessions.find((session) => session.id === id);
}

/** 会话状态机:所有分支均为纯函数(时间来源可注入,见 applySessionEvent 的 now) */
export function sessionsReducer(
  state: SessionStoreState,
  action: SessionAction,
): SessionStoreState {
  switch (action.type) {
    case "SESSION_CREATED":
      // 幂等:同 id 重复创建直接忽略
      if (state.sessions.some((session) => session.id === action.id)) return state;
      return { sessions: [...state.sessions, createSession(action.id)] };
    case "SESSION_REMOVED":
      // 关闭会话 = 从集合整条移除;pi 进程回收由 main 侧负责(本层纯逻辑不碰桥)
      return { sessions: state.sessions.filter((session) => session.id !== action.id) };
    case "SESSION_SET_STATE":
      return updateSession(state, action.id, (session) => ({
        ...session,
        processState: action.processState,
        // 崩溃分支:补默认错误文案(action.message 可覆盖),供错误横幅展示
        ...(action.processState === "crashed"
          ? { error: action.message ?? CRASHED_ERROR }
          : {}),
      }));
    case "SESSION_ERROR":
      return updateSession(state, action.id, (session) => ({
        ...session,
        error: action.message,
      }));
    case "UI_REQUEST_QUEUED":
      // FIFO 入队:同 id 请求去重,避免重复推送堆叠
      return updateSession(state, action.id, (session) =>
        session.uiRequests.some((request) => request.id === action.request.id)
          ? session
          : { ...session, uiRequests: [...session.uiRequests, action.request] },
      );
    case "UI_REQUEST_RESOLVED":
      // 出队:按 requestId 移除;未命中保持引用相等
      return updateSession(state, action.id, (session) => {
        const next = session.uiRequests.filter((request) => request.id !== action.requestId);
        return next.length === session.uiRequests.length ? session : { ...session, uiRequests: next };
      });
    case "EVENT":
      // 未知 sessionId 的事件直接丢弃(进程回收后期事件的兜底)
      return updateSession(state, action.sessionId, (session) =>
        applySessionEvent(session, action.event),
      );
    default:
      return state;
  }
}

/** message_update 内嵌事件 → 更新当前助手消息的文本/思考/工具 */
function applyAssistantDelta(
  session: SessionState,
  event: AssistantMessageEventLike,
  now: () => number,
): SessionState {
  switch (event.type) {
    case "text_delta":
      return appendStreamingText(session, "text", event.delta);
    case "thinking_delta":
      return appendStreamingText(session, "thinking", event.delta);
    case "toolcall_start":
      // 工具调用开始声明 → running(参数尚未完整,argsPreview 由 tool_execution_start 补)
      return upsertTool(
        session,
        {
          toolCallId: event.id ?? event.toolCall?.id,
          toolName: event.toolName ?? event.toolCall?.name ?? "",
          status: "running",
        },
        now,
      );
    case "toolcall_end":
      // 声明完成但尚未执行 → 仍为 running,三态最终由 tool_execution_end 定
      return upsertTool(
        session,
        {
          toolCallId: event.toolCall?.id ?? event.id,
          toolName: event.toolCall?.name ?? event.toolName ?? "",
          status: "running",
          argsPreview: preview(event.toolCall?.arguments),
        },
        now,
      );
    default:
      return session;
  }
}

/**
 * 把一条 pi 会话事件应用到会话(纯函数)。
 * now 默认 Date.now,可注入以便测试工具耗时(durationMs)。
 */
export function applySessionEvent(
  session: SessionState,
  event: SessionEvent,
  now: () => number = Date.now,
): SessionState {
  switch (event.type) {
    case "agent_start":
      // 新回合开始:置发送态,顺带清掉上一回合的残留错误
      return { ...session, sending: true, error: undefined };
    case "agent_settled":
      // 回合结束(含中止/失败兜底):复位发送态与流式指针
      return { ...session, sending: false, streamingMessageId: undefined };
    case "message_update": {
      let next = session;
      if (event.usage) next = applyUsage(next, event.usage);
      if (event.assistantMessageEvent) {
        next = applyAssistantDelta(next, event.assistantMessageEvent, now);
      }
      return next;
    }
    case "text_delta":
      return appendStreamingText(session, "text", event.delta);
    case "thinking_delta":
      return appendStreamingText(session, "thinking", event.delta);
    case "toolcall_start":
    case "toolcall_end":
      return applyAssistantDelta(session, event, now);
    case "message_start":
      // 仅助手消息开新流式条目;用户消息由 Composer 本地追加(T10b)
      return event.message?.role === "user" ? session : ensureStreaming(session);
    case "message_end":
      return finalizeMessage(session, event.message);
    case "tool_execution_start":
      return upsertTool(
        session,
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? "",
          status: "running",
          argsPreview: preview(event.args),
        },
        now,
      );
    case "tool_execution_update":
      // 执行中:保持 running,用最新部分结果刷新参数预览
      return upsertTool(
        session,
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? "",
          status: "running",
          argsPreview: preview(event.partialResult),
        },
        now,
      );
    case "tool_execution_end":
      return finishTool(session, event, now);
    case "queue_update":
      return {
        ...session,
        queueCounts: {
          steering: event.steering?.length ?? 0,
          followUp: event.followUp?.length ?? 0,
        },
      };
    case "session_info_changed":
      return typeof event.name === "string" ? { ...session, label: event.name } : session;
    default:
      // 未处理事件(compaction_start/end、auto_retry_* 等)忽略
      return session;
  }
}

/** 会话消息 id:会话内自增(仅追加,不会重复) */
function nextMessageId(session: SessionState): string {
  return `${session.id}#m${session.messages.length}`;
}

/** 保证存在「当前流式助手消息」:有则复用,无则新建空消息并挂上指针 */
function ensureStreaming(session: SessionState): SessionState {
  const id = session.streamingMessageId;
  if (id && session.messages.some((message) => message.id === id)) return session;
  const message: SessionMessageView = { id: nextMessageId(session), role: "assistant", text: "" };
  return { ...session, messages: [...session.messages, message], streamingMessageId: message.id };
}

/** 追加流式文本:store 只存累积文本,rAF 批量渲染由 MessageList 负责 */
function appendStreamingText(
  session: SessionState,
  field: "text" | "thinking",
  delta: string | undefined,
): SessionState {
  if (!delta) return session;
  const withStreaming = ensureStreaming(session);
  const id = withStreaming.streamingMessageId;
  return {
    ...withStreaming,
    messages: withStreaming.messages.map((message) => {
      if (message.id !== id) return message;
      return field === "text"
        ? { ...message, text: message.text + delta }
        : { ...message, thinking: (message.thinking ?? "") + delta };
    }),
  };
}

/**
 * usage → 当前助手消息 tokens。
 * 上游 JsonMessageUpdateEvent.usage 为「本条消息的累计值」,故直接取 totalTokens 覆盖,
 * 而非逐次求和(求和会重复计数)。
 */
function applyUsage(session: SessionState, usage: UsageLike): SessionState {
  const total = usageTotal(usage);
  if (total == null) return session;
  const withStreaming = ensureStreaming(session);
  const id = withStreaming.streamingMessageId;
  return {
    ...withStreaming,
    messages: withStreaming.messages.map((message) =>
      message.id === id ? { ...message, tokens: total } : message,
    ),
  };
}

/** usage 总 token:优先 totalTokens,缺失时退化为四项求和 */
function usageTotal(usage: UsageLike): number | undefined {
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    return usage.totalTokens;
  }
  const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  if (!parts.some((part) => typeof part === "number")) return undefined;
  return parts.reduce<number>((sum, part) => sum + (typeof part === "number" ? part : 0), 0);
}

/** message_end:当前助手消息定稿(正文以最终 message 为准,清流式指针) */
function finalizeMessage(session: SessionState, message?: AgentMessageLike): SessionState {
  // 用户消息的 message_end 不涉及流式助手条目,忽略
  if (message && message.role === "user") return session;
  const withStreaming = ensureStreaming(session);
  const id = withStreaming.streamingMessageId;
  const finalText = extractText(message?.content);
  const tokens = message?.usage ? usageTotal(message.usage) : undefined;
  return {
    ...withStreaming,
    streamingMessageId: undefined,
    messages: withStreaming.messages.map((item) =>
      item.id === id
        ? {
            ...item,
            ...(finalText ? { text: finalText } : {}),
            ...(tokens != null ? { tokens } : {}),
          }
        : item,
    ),
  };
}

/** 从上游消息 content(string | block[])提取正文文本 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object") {
        const candidate = block as { type?: unknown; text?: unknown };
        if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
      }
      return "";
    })
    .join("");
}

/** 插入/更新当前助手消息 tools 数组中的一行(按 toolCallId,退化按 toolName 定位) */
function upsertTool(
  session: SessionState,
  patch: {
    toolCallId?: string;
    toolName: string;
    status: ToolView["status"];
    argsPreview?: string;
  },
  now: () => number,
): SessionState {
  const withStreaming = ensureStreaming(session);
  const id = withStreaming.streamingMessageId;
  const key = patch.toolCallId ?? patch.toolName;
  return {
    ...withStreaming,
    messages: withStreaming.messages.map((message) => {
      if (message.id !== id) return message;
      const tools = [...(message.tools ?? [])];
      const index = tools.findIndex(
        (tool) => (tool.toolCallId ?? tool.toolName) === key,
      );
      if (index >= 0) {
        const prev = tools[index]!;
        tools[index] = {
          ...prev,
          toolName: patch.toolName || prev.toolName,
          status: patch.status,
          ...(patch.argsPreview ? { argsPreview: patch.argsPreview } : {}),
          ...(patch.toolCallId ? { toolCallId: patch.toolCallId } : {}),
        };
      } else {
        tools.push({
          toolName: patch.toolName,
          status: patch.status,
          ...(patch.argsPreview ? { argsPreview: patch.argsPreview } : {}),
          ...(patch.toolCallId ? { toolCallId: patch.toolCallId } : {}),
          ...(patch.status === "running" ? { startedAtMs: now() } : {}),
        });
      }
      return { ...message, tools };
    }),
  };
}

/** tool_execution_end:三态落定(ok / err)+ 耗时 + 失败 stderr */
function finishTool(session: SessionState, event: SessionEvent, now: () => number): SessionState {
  const withStreaming = ensureStreaming(session);
  const id = withStreaming.streamingMessageId;
  const key = event.toolCallId ?? event.toolName ?? "";
  return {
    ...withStreaming,
    messages: withStreaming.messages.map((message) => {
      if (message.id !== id) return message;
      const tools = [...(message.tools ?? [])];
      const index = tools.findIndex((tool) => (tool.toolCallId ?? tool.toolName) === key);
      const status: ToolView["status"] = event.isError ? "err" : "ok";
      const finishedAt = now();
      if (index >= 0) {
        const prev = tools[index]!;
        const durationMs =
          prev.startedAtMs != null ? Math.max(0, finishedAt - prev.startedAtMs) : undefined;
        tools[index] = {
          ...prev,
          status,
          ...(durationMs != null ? { durationMs } : {}),
          ...(event.isError ? { stderr: preview(event.result) } : {}),
        };
      } else {
        tools.push({
          toolName: event.toolName ?? "",
          status,
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          ...(event.isError ? { stderr: preview(event.result) } : {}),
        });
      }
      return { ...message, tools };
    }),
  };
}

/** 预览文本:对象 JSON 化并截断(工具参数/错误结果),防超长撑爆折叠行 */
function preview(value: unknown): string | undefined {
  if (value == null) return undefined;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? "";
    } catch {
      return undefined;
    }
  }
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// ---------- 桥订阅类型(与 shared/ipc.ts 的 PideskBridge 会话子集结构兼容) ----------

/** onSessionEvent 载荷 */
export type SessionEventPayload = { sessionId: string; event: SessionEvent };
/** onProcessState 载荷 */
export type ProcessStatePayload = { sessionId: string; state: PideskProcessState };

/** ui 包只用桥的订阅子集,避免为类型引入 @pidesk/shared 依赖 */
export type SessionBridge = {
  onSessionEvent(cb: (payload: SessionEventPayload) => void): () => void;
  onProcessState(cb: (payload: ProcessStatePayload) => void): () => void;
};

/** 取桥:显式入参优先,否则读 window.pidesk(非 Electron / 测试环境返回 undefined) */
export function resolveSessionBridge(explicit?: SessionBridge): SessionBridge | undefined {
  if (explicit) return explicit;
  const candidate = (globalThis as { pidesk?: Partial<SessionBridge> }).pidesk;
  if (
    candidate &&
    typeof candidate.onSessionEvent === "function" &&
    typeof candidate.onProcessState === "function"
  ) {
    return candidate as SessionBridge;
  }
  return undefined;
}

// ---------- context ----------

export type SessionsContextValue = {
  sessions: SessionState[];
  dispatch: Dispatch<SessionAction>;
  /** 便捷选择器:按 id 取会话 */
  getSession: (id: string) => SessionState | undefined;
};

export const SessionsContext = createContext<SessionsContextValue | null>(null);
