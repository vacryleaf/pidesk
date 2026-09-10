/**
 * session-store 测试(T10a):纯 reducer / 事件应用函数的状态断言。
 * 覆盖:会话增删(含移除回收)、agent_settled 复位、text_delta 累积(顶层与内嵌)、
 * 工具三态更新、usage 累计、message_end 定稿、SESSION_ERROR、crashed 记录、队列计数、
 * 未知事件/未知会话不改状态。
 * 时间来源经 applySessionEvent 的 now 注入,保证耗时断言确定性。
 */
import { describe, expect, it } from "vitest";
import {
  applySessionEvent,
  initialSessionStore,
  selectSession,
  sessionsReducer,
  type SessionEvent,
  type SessionState,
  type SessionStoreState,
} from "./session-store";

/** 建一个会话 */
function create(id = "s1"): SessionStoreState {
  return sessionsReducer(initialSessionStore, { type: "SESSION_CREATED", id });
}

/** 取会话(测试断言用,不存在即失败) */
function pick(state: SessionStoreState, id = "s1"): SessionState {
  const session = selectSession(state, id);
  if (!session) throw new Error(`会话 ${id} 不存在`);
  return session;
}

/** 经 reducer 的 EVENT 动作应用事件 */
function send(state: SessionStoreState, event: SessionEvent, id = "s1"): SessionStoreState {
  return sessionsReducer(state, { type: "EVENT", sessionId: id, event });
}

/** 可控时钟:工具耗时断言用 */
function clock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("会话集合生命周期", () => {
  it("SESSION_CREATED 追加默认态会话,同 id 幂等", () => {
    const one = create("s1");
    expect(one.sessions).toHaveLength(1);
    expect(pick(one)).toMatchObject({
      id: "s1",
      messages: [],
      sending: false,
      processState: "spawning",
      queueCounts: { steering: 0, followUp: 0 },
    });
    expect(create("s1")).toBeDefined();
    expect(sessionsReducer(one, { type: "SESSION_CREATED", id: "s1" })).toBe(one);
  });

  it("SESSION_REMOVED 整条移除(进程回收由 main 负责)", () => {
    const two = sessionsReducer(create("s1"), { type: "SESSION_CREATED", id: "s2" });
    const after = sessionsReducer(two, { type: "SESSION_REMOVED", id: "s1" });
    expect(after.sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(selectSession(after, "s1")).toBeUndefined();
  });
});

describe("回合发送态", () => {
  it("agent_start 置 sending,agent_settled 复位并清流式指针", () => {
    let state = send(create(), { type: "agent_start" });
    expect(pick(state).sending).toBe(true);

    state = send(state, { type: "text_delta", delta: "你好" });
    expect(pick(state).streamingMessageId).toBeDefined();

    state = send(state, { type: "agent_settled" });
    expect(pick(state).sending).toBe(false);
    expect(pick(state).streamingMessageId).toBeUndefined();
  });

  it("agent_start 清掉上一回合残留错误", () => {
    let state = sessionsReducer(create(), { type: "SESSION_ERROR", id: "s1", message: "boom" });
    expect(pick(state).error).toBe("boom");
    state = send(state, { type: "agent_start" });
    expect(pick(state).error).toBeUndefined();
  });
});

describe("助手消息文本累积", () => {
  it("顶层 text_delta 累积到同一条助手消息", () => {
    let state = send(create(), { type: "agent_start" });
    state = send(state, { type: "text_delta", delta: "你" });
    state = send(state, { type: "text_delta", delta: "好" });
    const messages = pick(state).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "assistant", text: "你好" });
  });

  it("message_update.assistantMessageEvent 内嵌形态同样累积", () => {
    let state = send(create(), { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "abc" } });
    state = send(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "def" } });
    expect(pick(state).messages[0]?.text).toBe("abcdef");
  });

  it("thinking_delta 累积到 thinking 字段", () => {
    const state = send(create(), { type: "thinking_delta", delta: "思考中" });
    expect(pick(state).messages[0]?.thinking).toBe("思考中");
    expect(pick(state).messages[0]?.text).toBe("");
  });

  it("message_end 以最终消息定稿正文并清流式指针", () => {
    let state = send(create(), { type: "text_delta", delta: "半句" });
    state = send(state, {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "完整正文" }] },
    });
    expect(pick(state).messages[0]?.text).toBe("完整正文");
    expect(pick(state).streamingMessageId).toBeUndefined();
  });
});

describe("工具调用三态", () => {
  it("toolcall_start → running;tool_execution_end → ok + 耗时", () => {
    const t = clock(1000);
    let session = pick(create());
    session = applySessionEvent(
      session,
      { type: "message_update", assistantMessageEvent: { type: "toolcall_start", id: "tc1", toolName: "bash" } },
      t.now,
    );
    expect(session.messages[0]?.tools?.[0]).toMatchObject({ toolName: "bash", status: "running" });

    t.advance(250);
    session = applySessionEvent(
      session,
      { type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", isError: false },
      t.now,
    );
    expect(session.messages[0]?.tools?.[0]).toMatchObject({ status: "ok", durationMs: 250 });
  });

  it("tool_execution_end(isError) → err + stderr;同名工具靠 toolCallId 区分", () => {
    const t = clock(0);
    let session = pick(create());
    session = applySessionEvent(session, { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "x" } }, t.now);
    session = applySessionEvent(session, { type: "tool_execution_start", toolCallId: "b", toolName: "read", args: { path: "y" } }, t.now);
    expect(session.messages[0]?.tools).toHaveLength(2);

    session = applySessionEvent(session, { type: "tool_execution_end", toolCallId: "b", toolName: "read", isError: true, result: "ENOENT" }, t.now);
    const tools = session.messages[0]?.tools ?? [];
    expect(tools[0]).toMatchObject({ toolCallId: "a", status: "running" });
    expect(tools[1]).toMatchObject({ toolCallId: "b", status: "err", stderr: "ENOENT" });
  });

  it("tool_execution_start 生成参数预览并截断", () => {
    const t = clock(0);
    const session = applySessionEvent(pick(create()), { type: "tool_execution_start", toolCallId: "c", toolName: "bash", args: { cmd: "x".repeat(200) } }, t.now);
    const argsPreview = session.messages[0]?.tools?.[0]?.argsPreview ?? "";
    expect(argsPreview.endsWith("...")).toBe(true);
    expect(argsPreview.length).toBe(80);
  });
});

describe("usage 与 token", () => {
  it("message_update.usage 取上游累计 totalTokens 覆盖条目 tokens", () => {
    let state = send(create(), { type: "message_update", usage: { totalTokens: 12 }, assistantMessageEvent: { type: "text_delta", delta: "a" } });
    expect(pick(state).messages[0]?.tokens).toBe(12);
    state = send(state, { type: "message_update", usage: { totalTokens: 30 }, assistantMessageEvent: { type: "text_delta", delta: "b" } });
    expect(pick(state).messages[0]?.tokens).toBe(30);
    expect(pick(state).messages[0]?.text).toBe("ab");
  });

  it("缺 totalTokens 时退化为输入/输出等四项求和", () => {
    const state = send(create(), { type: "message_update", usage: { input: 3, output: 4, cacheRead: 2 } });
    expect(pick(state).messages[0]?.tokens).toBe(9);
  });
});

describe("错误 / 进程态 / 队列", () => {
  it("SESSION_ERROR 写入 error 字段", () => {
    const state = sessionsReducer(create(), { type: "SESSION_ERROR", id: "s1", message: "进程退出" });
    expect(pick(state).error).toBe("进程退出");
  });

  it("SESSION_SET_STATE 记录 crashed(崩溃呈现留 T10c)", () => {
    const state = sessionsReducer(create(), { type: "SESSION_SET_STATE", id: "s1", processState: "crashed" });
    expect(pick(state).processState).toBe("crashed");
    expect(pick(sessionsReducer(state, { type: "SESSION_SET_STATE", id: "s1", processState: "ready" })).processState).toBe("ready");
  });

  it("queue_update 更新 steering/followUp 计数", () => {
    const state = send(create(), { type: "queue_update", steering: ["a"], followUp: ["b", "c"] });
    expect(pick(state).queueCounts).toEqual({ steering: 1, followUp: 2 });
  });

  it("session_info_changed 更新标签", () => {
    const state = send(create(), { type: "session_info_changed", name: "重构会话" });
    expect(pick(state).label).toBe("重构会话");
  });
});

describe("健壮性", () => {
  it("未知事件与未知会话均不改变状态引用", () => {
    const state = send(create(), { type: "text_delta", delta: "x" });
    expect(send(state, { type: "compaction_start", reason: "manual" } as SessionEvent)).toBe(state);
    expect(send(state, { type: "agent_start" }, "ghost")).toBe(state);
  });

  it("user 消息的 message_end 不影响流式助手条目", () => {
    let state = send(create(), { type: "text_delta", delta: "进行中" });
    const streamingId = pick(state).streamingMessageId;
    state = send(state, { type: "message_end", message: { role: "user", content: "hi" } });
    expect(pick(state).streamingMessageId).toBe(streamingId);
    expect(pick(state).messages).toHaveLength(1);
  });
});
