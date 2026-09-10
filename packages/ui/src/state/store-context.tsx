/**
 * SessionsProvider / useSessions(T10a)—— 把 session-store 的 reducer 接到 React 树,
 * 并订阅 window.pidesk 的 onSessionEvent / onProcessState 推送。
 *
 * 与纯逻辑分文件的原因:Provider 含 JSX,需要 .tsx 扩展名。
 */
import { useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import {
  initialSessionStore,
  resolveSessionBridge,
  sessionsReducer,
  SessionsContext,
  type SessionsContextValue,
  type SessionBridge,
} from "./session-store";

/**
 * 会话上下文根:外部可注入 bridge(测试/Storybook);缺省自动读 window.pidesk。
 * 订阅在卸载时统一退订,避免热更新/会话切换后重复分发。
 */
export function SessionsProvider({
  bridge,
  children,
}: {
  bridge?: SessionBridge;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(sessionsReducer, initialSessionStore);

  useEffect(() => {
    const resolved = resolveSessionBridge(bridge);
    if (!resolved) return;
    const offEvent = resolved.onSessionEvent(({ sessionId, event }) =>
      dispatch({ type: "EVENT", sessionId, event }),
    );
    const offProcess = resolved.onProcessState(({ sessionId, state: processState }) =>
      dispatch({ type: "SESSION_SET_STATE", id: sessionId, processState }),
    );
    return () => {
      offEvent();
      offProcess();
    };
  }, [bridge]);

  const value = useMemo<SessionsContextValue>(
    () => ({
      sessions: state.sessions,
      dispatch,
      getSession: (id: string) => state.sessions.find((session) => session.id === id),
    }),
    [state.sessions],
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

/** 取会话上下文;必须在 SessionsProvider 内使用 */
export function useSessions(): SessionsContextValue {
  const context = useContext(SessionsContext);
  if (!context) throw new Error("useSessions 必须在 <SessionsProvider> 内使用");
  return context;
}
