import { useCallback, useRef, useState } from "react";
import { Composer } from "./composer";
import { ModelMenu, type ModelInfo } from "./model-menu";
import { MessageList, type MessageView } from "./message-list";
import { SessionTabs } from "./session-tabs";
import { useSessions } from "../state/store-context";
import type { SessionState } from "../state/session-store";

/** 会话动作桥:session-view 只需这三个写操作(与 window.pidesk 结构兼容子集) */
export type SessionActionBridge = {
  sessionCreate(): Promise<{ sessionId: string }>;
  sessionPrompt(sessionId: string, message: string): Promise<unknown>;
  sessionAbort(sessionId: string): Promise<unknown>;
  sessionGetState?(sessionId: string): Promise<{
    model?: { id?: string; provider?: string };
    thinkingLevel?: string;
  }>;
  sessionListModels?(sessionId: string): Promise<{ models: ModelInfo[] }>;
  sessionSetModel?(sessionId: string, provider: string, modelId: string): Promise<unknown>;
  sessionSetThinkingLevel?(sessionId: string, level: string): Promise<unknown>;
};

type ModelView = { provider: string; modelId: string; thinkingLevel: string };
const DEFAULT_MODEL_VIEW: ModelView = { provider: "ollama", modelId: "选择模型", thinkingLevel: "off" };

/** 取动作桥:显式入参优先,否则读 window.pidesk(非 Electron / 测试环境返回 undefined) */
function resolveActionBridge(explicit?: SessionActionBridge): SessionActionBridge | undefined {
  if (explicit) return explicit;
  const candidate = (globalThis as { pidesk?: Partial<SessionActionBridge> }).pidesk;
  if (
    candidate &&
    typeof candidate.sessionCreate === "function" &&
    typeof candidate.sessionPrompt === "function" &&
    typeof candidate.sessionAbort === "function"
  ) {
    return candidate as SessionActionBridge;
  }
  return undefined;
}

/** 本地用户消息锚点:at = 发送时刻 store 中已有助手消息条数,渲染时据此插回原位 */
type UserInsert = { at: number; message: MessageView };

/** 把 store 会话消息与本地用户消息合并成展示序列(保持发送顺序,不丢助手消息) */
function mergeMessages(session: SessionState, inserts: UserInsert[]): MessageView[] {
  const byIndex = new Map<number, MessageView[]>();
  for (const insert of inserts) {
    const list = byIndex.get(insert.at);
    if (list) list.push(insert.message);
    else byIndex.set(insert.at, [insert.message]);
  }
  const out: MessageView[] = [];
  session.messages.forEach((message, index) => {
    const pending = byIndex.get(index);
    if (pending) out.push(...pending);
    out.push(message);
  });
  // 已发送但助手尚未开流的用户消息(at 等于当前条数)统一接在末尾
  const tail = byIndex.get(session.messages.length);
  if (tail) out.push(...tail);
  return out;
}

export type SessionViewProps = {
  /** 动作桥注入(测试用);缺省读 window.pidesk */
  actions?: SessionActionBridge;
};

/**
 * SessionView(T10b)—— 会话主区:标签栏 + 消息流 + 输入区。
 * 空态(无会话)为 Wegent DesktopEmptyTaskLauncher 式引导:居中大标题 + 直接可发起首条会话的 Composer。
 * 用户消息由本层本地维护(store 只承载助手流式消息,见 T10a message_start 分支),
 * 渲染时按发送时刻的助手消息条数锚点插回原位。
 */
export function SessionView({ actions }: SessionViewProps) {
  const { sessions, dispatch, getSession } = useSessions();
  const bridge = resolveActionBridge(actions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [userMessages, setUserMessages] = useState<Record<string, UserInsert[]>>({});
  const [modelViews, setModelViews] = useState<Record<string, ModelView>>({});
  // 本地用户消息序号:避免同一毫秒内多次发送产生重复 id
  const seqRef = useRef(0);

  // 激活会话:activeId 失效(被关闭)时回退到首个会话
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0] ?? null;
  const activeModelView = active?.id ? modelViews[active.id] ?? DEFAULT_MODEL_VIEW : DEFAULT_MODEL_VIEW;

  /** 新建:先经桥建会话,拿到 sessionId 再入 store 并激活 */
  const handleCreate = () => {
    if (!bridge) return;
    void bridge.sessionCreate().then(({ sessionId }) => {
      dispatch({ type: "SESSION_CREATED", id: sessionId });
      setActiveId(sessionId);
      if (bridge.sessionGetState) {
        void bridge
          .sessionGetState(sessionId)
          .then((state) => {
            setModelViews((prev) => ({
              ...prev,
              [sessionId]: {
                provider: state.model?.provider ?? DEFAULT_MODEL_VIEW.provider,
                modelId: state.model?.id ?? DEFAULT_MODEL_VIEW.modelId,
                thinkingLevel: state.thinkingLevel ?? DEFAULT_MODEL_VIEW.thinkingLevel,
              },
            }));
          })
          .catch(() => {});
      }
    });
  };

  /** 发送:本地追加用户消息(锚定当前助手消息条数)并下发 prompt */
  const handleSend = (sessionId: string, text: string) => {
    const at = getSession(sessionId)?.messages.length ?? 0;
    const message: MessageView = {
      id: `${sessionId}#u${seqRef.current++}`,
      role: "user",
      text,
    };
    setUserMessages((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] ?? []), { at, message }],
    }));
    void bridge?.sessionPrompt(sessionId, text);
  };

  /** 空态首条消息:建会话 → 入 store 并激活 → 回填本地用户消息 → 下发首条 prompt */
  const handleEmptySend = (text: string) => {
    if (!bridge) return;
    void bridge.sessionCreate().then(({ sessionId }) => {
      dispatch({ type: "SESSION_CREATED", id: sessionId });
      setActiveId(sessionId);
      const message: MessageView = {
        id: `${sessionId}#u${seqRef.current++}`,
        role: "user",
        text,
      };
      setUserMessages((prev) => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] ?? []), { at: 0, message }],
      }));
      if (bridge.sessionGetState) {
        void bridge
          .sessionGetState(sessionId)
          .then((state) => {
            setModelViews((prev) => ({
              ...prev,
              [sessionId]: {
                provider: state.model?.provider ?? DEFAULT_MODEL_VIEW.provider,
                modelId: state.model?.id ?? DEFAULT_MODEL_VIEW.modelId,
                thinkingLevel: state.thinkingLevel ?? DEFAULT_MODEL_VIEW.thinkingLevel,
              },
            }));
          })
          .catch(() => {});
      }
      void bridge.sessionPrompt(sessionId, text);
    });
  };

  /** 模型/档位:先本地回显,再经桥下发 */
  const handleSetModel = (sessionId: string, provider: string, modelId: string) => {
    setModelViews((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] ?? DEFAULT_MODEL_VIEW), provider, modelId },
    }));
    void bridge?.sessionSetModel?.(sessionId, provider, modelId);
  };

  const handleSetThinkingLevel = (sessionId: string, level: string) => {
    setModelViews((prev) => ({
      ...prev,
      [sessionId]: { ...(prev[sessionId] ?? DEFAULT_MODEL_VIEW), thinkingLevel: level },
    }));
    void bridge?.sessionSetThinkingLevel?.(sessionId, level);
  };

  const listModelsFor = useCallback(
    (sessionId: string): Promise<ModelInfo[]> =>
      bridge?.sessionListModels ? bridge.sessionListModels(sessionId).then((r) => r.models) : Promise.resolve([]),
    [bridge],
  );
  const listModelsActive = useCallback(() => listModelsFor(active?.id ?? ""), [active?.id, listModelsFor]);

  /** 中止:仅下发 sessionAbort,发送态复位由 agent_settled 事件驱动 */
  const handleAbort = (sessionId: string) => {
    void bridge?.sessionAbort(sessionId);
  };

  /** 关闭:渲染层只删状态;进程回收由 main 侧 manager 负责,abort 兜底 */
  const handleClose = (sessionId: string) => {
    dispatch({ type: "SESSION_REMOVED", id: sessionId });
    setUserMessages((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    void bridge?.sessionAbort(sessionId);
  };

  // 空态:无任何会话,Wegent DesktopEmptyTaskLauncher 式引导 + 直接可输入的 Composer
  if (sessions.length === 0) {
    return (
      <section
        data-testid="session-empty"
        className="flex min-h-0 min-w-0 flex-1 flex-col px-6 pb-2 pt-8"
      >
        <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
          <h1 className="max-w-full text-center text-[28px] font-normal leading-9 tracking-normal text-[var(--text-0)]">
            我们该做什么？
          </h1>
        </div>
        <div className="mx-auto w-[min(46rem,calc(100%-2rem))] min-w-0 shrink-0">
          <Composer sending={false} placeholder="随心输入" onSend={handleEmptySend} onAbort={() => {}} />
        </div>
      </section>
    );
  }

  const messages = active ? mergeMessages(active, userMessages[active.id] ?? []) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionTabs
        sessions={sessions.map((session) => ({ id: session.id, label: session.label }))}
        activeId={active?.id ?? null}
        onSelect={setActiveId}
        onClose={handleClose}
        onCreate={handleCreate}
      />
      {active ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* grid 单元让 MessageList 双向撑满,其自身 overflow-y-auto 才能生效 */}
          <div className="grid min-h-0 flex-1 grid-rows-1">
            <MessageList messages={messages} />
          </div>
          {/* Composer 与消息列共用同一 48rem 内容列,横向 gutter 20px(Wegent §5.1/5.5) */}
          <div className="shrink-0 px-5 pb-3">
            <div className="mx-auto w-full max-w-[48rem]">
              <Composer
                sending={active.sending}
                queueCounts={active.queueCounts}
                onSend={(text) => handleSend(active.id, text)}
                onAbort={() => handleAbort(active.id)}
                footerLeft={
                  <ModelMenu
                    provider={activeModelView.provider}
                    modelId={activeModelView.modelId}
                    thinkingLevel={activeModelView.thinkingLevel}
                    onSetModel={(p, m) => handleSetModel(active.id, p, m)}
                    onSetThinkingLevel={(lv) => handleSetThinkingLevel(active.id, lv)}
                    listModels={listModelsActive}
                  />
                }
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
