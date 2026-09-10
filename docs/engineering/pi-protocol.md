# pidesk × pi RPC 协议详设(pi-protocol v1.0)

> 2026-09-10。E 阶段产物之一(dev-process §1)。
> **来源钉版**:pi 上游 `main@400d6905`(v0.85.1),本文全部结论以该版本源码为准;主要出处:`packages/coding-agent/src/modes/rpc/{rpc-types.ts, rpc-mode.ts, jsonl.ts, rpc-client.ts}`、`src/modes/json-event.ts`、`packages/agent/src/types.ts`、`packages/ai/src/types.ts`。
> ⚠️ pi RPC 无兼容承诺(product-plan R1):本文档是 pidesk 侧的**对齐快照**,pi 升级必须按 dev-process §10 重推本档。

---

## 0. 一页速览(环节一审阅入口)

1. **传输**:单进程 stdio 上的严格 JSONL——**只按 `\n` 分帧**(上游专用实现,明确禁用 readline,因其会按 U+2028/U+2029 错误切分),容忍 `\r\n`,UTF-8 多字节安全。stdout 被协议独占(pi 内部杂散输出已被上游重定向),日志走 stderr。
2. **封套四类**(stdout 单流混排,按 `type` 字段分派):`response`(命令响应)、`extension_ui_request`(扩展 UI 请求,含审批/确认类交互)、`extension_error`、**其余全部是会话事件**(约 20 种)。
3. **命令 30 个**(stdin,`type` + 可选 `id`),覆盖:提示/插话/中止/队列、状态、模型、思考档位、压缩、重试、bash、会话树/切换/分支/克隆、消息回放、统计。
4. **请求关联**:命令带 `id` → `response.id` 回带;`prompt` 的响应**只在 preflight 成功后才回**(滞后,可能晚于首批事件);解析失败回 `command:"parse"` 无 id。
5. **流式文本**:`message_update` 事件的 wire 形态已由上游剥离 `partial` 累积快照(省带宽),文本增量走 `assistantMessageEvent.text_delta` 等 12 种子事件;`usage` 随每条 `message_update` 携带。
6. **pidesk 侧新增设计**(协议之外,本文 §7~§9):客户端 id 规范、超时分级、错误三级分类、会话生命周期状态机(spawning→handshaking→ready→busy→stopping→crashed/stopped)、崩溃重启 + `switch_session` 会话恢复、启动前 `--version` 独立进程版本预检。
7. **待你裁决的 4 个开放问题**:见 §11(类型来源方案、prompt 超时、Windows 信号兜底、compact 超时)。

---

## 1. 传输与分帧

| 项 | 规定 | 出处 |
|----|------|------|
| 载体 | pi 子进程 stdin/stdout,单工各一方向 | rpc-mode.ts |
| 帧格式 | 严格 JSONL:一行一个 JSON 值 | jsonl.ts `serializeJsonLine` |
| **分帧规则** | **仅 `\n` 切分**;行尾 `\r` 剥离(容忍 CRLF);**禁用 Node readline**(其按 Unicode 段落分隔符切分,JSON 字符串内合法,会切坏帧) | jsonl.ts 注释 |
| 编码 | UTF-8,`StringDecoder` 处理跨 chunk 多字节 | jsonl.ts `attachJsonlLineReader` |
| 半行收尾 | 流结束时残缺 buffer 作为最后一行发出(尾行可不带 `\n`) | jsonl.ts `onEnd` |
| stdout 纯度 | pi 启动即 `takeOverStdout()`,内部杂散 console 输出被重定向,**stdout 只有协议帧** | rpc-mode.ts / output-guard |
| stderr | 调试/日志通道;客户端累积用于错误上下文 | rpc-client.ts |

> pidesk 实现要求:分帧器按上游语义自研(缓冲 + `indexOf("\n")` 循环 + StringDecoder),配 L1 单测(跨 chunk 多字节、CRLF、U+2028 字符串、无尾换行)。

## 2. stdout 封套与解析分派

每行 JSON 解析后按 `type` 字段分派:

| `type` 值 | 含义 | 方向 |
|-----------|------|------|
| `response` | 命令响应(`command` 回带命令名;`success:true` + `data?` / `success:false` + `error`) | → pidesk |
| `extension_ui_request` | 扩展 UI 请求:`select`/`confirm`/`input`/`editor`(需回 `extension_ui_response`);`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text`(fire-and-forget) | → pidesk |
| `extension_ui_response` | 对 UI 请求的应答(`id` 关联;`value`/`confirmed`/`cancelled`) | ← pidesk |
| `extension_error` | 扩展错误上报 `{extensionPath, event, error}` | → pidesk |
| 其余(约 20 种) | 会话事件(§4) | → pidesk |

stdin 侧命令解析失败(非法 JSON):pi 回 `{type:"response", command:"parse", success:false, error}`(**无 id**)→ pidesk 归入协议级错误计数。

## 3. 命令全集(stdin →,30 个)

`id?` 均可选;响应 `data` 列为 success:true 时携带的内容。分组:

**提示与队列**

| type | 参数 | 响应 data | 备注 |
|------|------|-----------|------|
| `prompt` | `message`, `images?`, `streamingBehavior?: "steer"\|"followUp"` | 无 | **响应滞后**:preflight 成功才回;事件随后流式到达 |
| `steer` | `message`, `images?` | 无 | 插话进当前轮 |
| `follow_up` | `message`, `images?` | 无 | 排队为下一轮 |
| `abort` | — | 无 | 中止当前流 |
| `clear_queue` | — | `{steering[], followUp[]}` | |
| `new_session` | `parentSession?` | `{cancelled}` | cancelled=用户在扩展层拒绝 |

**状态/模型/思考**

| type | 参数 | 响应 data |
|------|------|-----------|
| `get_state` | — | `RpcSessionState`(model/thinkingLevel/isStreaming/isCompacting/steeringMode/followUpMode/sessionFile/sessionId/sessionName/autoCompactionEnabled/messageCount/pendingMessageCount) |
| `set_model` | `provider`, `modelId` | `Model`(找不到→error `Model not found`) |
| `cycle_model` | — | `{model, thinkingLevel, isScoped} \| null` |
| `get_available_models` | — | `{models[]}` |
| `set_thinking_level` | `level` | 无 |
| `cycle_thinking_level` | — | `{level} \| null` |
| `get_available_thinking_levels` | — | `{levels[]}` |

**队列模式/压缩/重试**: `set_steering_mode`(`all`\|`one-at-a-time`)、`set_follow_up_mode`(同)、`compact`(`customInstructions?`→`CompactionResult`,长阻塞)、`set_auto_compaction`、`set_auto_retry`、`abort_retry`(均无 data)。

**Bash(宿主侧快捷执行)**: `bash`(`command`, `excludeFromContext?`→`BashResult`,长阻塞)、`abort_bash`。

**会话/消息**: `get_session_stats`(→`SessionStats`,tokens/cost)、`export_html`(`outputPath?`→`{path}`)、`switch_session`(`sessionPath`→`{cancelled}`)、`fork`(`entryId`→`{text, cancelled}`)、`clone`(→`{cancelled}`)、`get_fork_messages`(→`{messages:[{entryId,text}]}`)、`get_entries`(`since?`→`{entries, leafId}`)、`get_tree`(→`{tree, leafId}`)、`get_last_assistant_text`(→`{text\|null}`)、`set_session_name`(`name`,空名→error)、`get_messages`(→`{messages}`)、`get_commands`(→`{commands:[{name,description,source:"extension"\|"prompt"\|"skill"}]}`)。

**未知命令**:回 error `Unknown command: <type>`。

## 4. 事件全集(stdout →,除 §2 四类封套外)

### 4.1 会话级(AgentSessionEvent,session.subscribe 直出)

生命周期:`agent_start`、`agent_end`(**会话变体**:`{messages, willRetry}`)、`agent_settled`(**回合清算完毕=空闲信号**,pidesk 状态机依赖)、`turn_start`、`turn_end`。
消息:`message_start`、`message_update`(见 4.2)、`message_end`。
工具:`tool_execution_start {toolCallId, toolName, args}`、`tool_execution_update {…, partialResult}`、`tool_execution_end {…, result, isError}`。
队列/压缩/重试:`queue_update {steering[], followUp[]}`、`compaction_start {reason: manual\|threshold\|overflow}`、`compaction_end {reason, result?, aborted, willRetry, errorMessage?}`、`auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}`、`auto_retry_end {success, attempt, finalError?}`、`summarization_retry_scheduled`、`summarization_retry_attempt_start`(branchSummary / compaction 两形态)、`summarization_retry_finished`。
其它:`entry_appended {entry}`(appendEntry 持久化,flow-bridge 依赖)、`session_info_changed {name?}`、`thinking_level_changed {level}`。

### 4.2 流式子事件(message_update 的 wire 形态)

**上游已做 wire 优化**:剥除 `partial` 累积快照,信封为 `{type:"message_update", usage, assistantMessageEvent}`;`toolcall_start` 额外补 `id`/`toolName`(从快照提取,免维护累积态)。

`assistantMessageEvent` 12 种:`start`、`text_start`/`text_delta {delta}`/`text_end {content}`、`thinking_start`/`thinking_delta {delta}`/`thinking_end {content}`、`toolcall_start`/`toolcall_delta {delta}`/`toolcall_end {toolCall}`、`done {reason: stop\|length\|toolUse\|deferred}`、`error {reason: aborted\|error}`。

> UI 渲染规则(ui-prototype §2.3 对话流):`text_delta` → markdown 追加;`thinking_delta` → 折叠思考块;`toolcall_end` → 触发工具折叠行(工具执行三态由 `tool_execution_*` 驱动);`done/error` → 收尾。

## 5. 退出语义

| 场景 | 行为 | 退出码 |
|------|------|--------|
| stdin end(宿主关闭管道) | 优雅停机 | 0 |
| 扩展请求停机 | 等最后一个 `agent_settled` 后停 | 0 |
| SIGTERM / SIGHUP | 杀追踪的子进程树后停 | 143 / 129 |
| 协议无关崩溃 | 非零退出或 spawn 失败 | 任意 |

## 6. 请求关联与超时(pidesk 客户端策略)

- **id 规范**:`req_<自增>`,PendingRequest 表关联;`prompt` 允许响应晚到,超时独立设置。
- **超时分级**(可配置,初值待 §11 确认):即时类(get_state/set_*/get_*)5s;`prompt`(preflight)30s;`compact` 120s;`bash`/`export_html` 无超时(事件驱动 + `abort`/`abort_bash` 兜底)。
- **事件乱序容忍**:响应可能与事件交错到达(id 关联是唯一正确方式,禁止"下一个 response 之前的都是该命令的事件"假设)。

## 7. 错误三级分类

| 级 | 定义 | 判定 | 处理 |
|----|------|------|------|
| L1 传输 | spawn 失败 / 非零退出 / stdin 断裂 / stdout 帧解析失败 | 进程事件、JSON.parse 异常 | 单行损坏:丢弃+计数;**连续 5 行损坏→协议破裂**,按 crashed 处理 |
| L2 协议 | `response.success:false`(`error` 字符串);`command:"parse"`/`Unknown command` | 封套字段 | 按命令映射 UI 提示;parse/unknown 计为缺陷并记录上游版本 |
| L3 业务 | 模型流错误(`assistantMessageEvent error`)、`auto_retry_*`、`compaction_end errorMessage`、`extension_error` | 事件字段 | UI 状态呈现;不中断进程 |

## 8. 会话生命周期状态机(pidesk 侧)

```
spawning ── 进程起 ──▶ handshaking ── get_state 成功 ──▶ ready
                          │ spawn 失败/预检不过             │ ▲
                          ▼                                prompt/steer/follow_up 响应 ok
                        crashed ◀── L1/非零退出 ──┐        ▼
                                                     busy ── agent_settled ──▶ ready
ready ── abort 已发 ──▶ stopping ── agent_end ──▶ ready
任意态 ── 宿主主动停 ──▶ stopped(回收/退出)
```

- **握手**:`get_state` 成功即 ready(响应含完整状态快照,直接灌 UI)。无内建 hello 帧,首测 get_state 是官方推荐位的握手(rpc-client 以 100ms+exitCode 粗检,我们做得更严)。
- **版本预检**:spawn RPC 进程**之前**,以独立短进程跑 `<pi binary> --version`,与 resources/pi/pi-manifest.json 锁定版本比对;不符→告警横幅(T3),不阻断开发模式。
- **崩溃重启**:指数退避 1s/2s/4s,上限 3 次;重启成功后若有原 `sessionFile` → `switch_session` 恢复上下文,否则提示用户。3 次耗尽→面板报错,进程池不再自动拉起。
- **孤儿防护**:pidesk 退出时先 `stdin.end()`(走优雅停机),宽限 3s 后 SIGTERM,再 2s 后树杀(Windows `taskkill /T`)。

## 9. M1 使用子集(其余延后)

- **必须**:`prompt`/`steer`/`abort`/`get_state`/`set_model`/`get_available_models`/`set_thinking_level`/`get_messages`/`get_session_stats`/`new_session`;事件全收(渲染层需要全部流式事件);`extension_ui_request` 实现 `confirm`/`select`/`input`/`notify`(M2 的 mcp-bridge 依赖)。
- **延后 M2+**:`compact` UI 入口、`fork`/`clone`/`get_tree` 会话树、`export_html`、`bash`、`switch_session`(崩溃恢复路径内部先用)、队列模式设置。

## 10. 类型来源方案(已裁决 DR-001:方案 A)

- **方案 A(已采纳)**:`@earendil-works/pi-coding-agent` 以 **devDependency + `import type`** 引入上游类型(`RpcCommand/RpcResponse/JsonAgentSessionEvent`),零运行时依赖,pi 升级时 tsc 报错即改动清单(锁版本下安全);实施于 M1 脚手架时登记 DEPENDENCIES.md(dev 类)。详见 decisions.md DR-001。
- 方案 B(类型 vendoring):不采纳——传递闭包横跨三包约 500~1000 行,人工同步易静默漂移。

## 11. 开放问题(已全部裁决,2026-09-10)

1. 类型来源 → **DR-001**(方案 A:devDependency + import type)。
2. prompt 超时 30s → **DR-002 采纳**。
3. Windows 退出兜底(3s→SIGTERM→2s→taskkill /T)→ **DR-002 采纳**。
4. compact 超时 120s → **DR-002 采纳**。

后续协议层新增裁决一律记 decisions.md,不在本档追加。

---

## 审阅指引(环节一)

1. **核对来源**:§3/§4 命令与事件全集请抽查对照上游 `rpc-types.ts`(297 行,唯一权威);§1 分帧对照 `jsonl.ts`(58 行)。
2. **重点判定**:§6 超时分级、§7 错误分类、§8 状态机与重启策略——这三节是 pidesk 侧自研设计,上游无对应物,错了 M1 返工成本最高。
3. **必须裁决**:§11 四个开放问题给结论(或"按推荐"),我记入 decisions.md 后再产出 m1-design.md。
