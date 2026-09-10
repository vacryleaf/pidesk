# pidesk 产品与架构规划（S1，v1.0）

> 需求代号：pidesk-m1。状态：**设计中**（2026-09-10，S1 规划完成，待用户确认后进入 M1 编码）。
> 本文档为唯一权威规划；与 README.md 或后续代码冲突时，以本文最新修订为准（修订须追加裁决记录）。

---

## 1. 定位与目标

独立桌面应用（Windows / Linux / macOS），非 vtools 衍生、全新代码库：

1. **AI 会话工作台**（对标 Wegent Desktop 任务视图）：多会话面板，底层 pi 子进程执行，流式输出、工具过程、审批、模型切换。
2. **执行端完全隔离**：应用内 pi 会话只由本应用管理，全局 pi 不可见、不可复用；反之应用也不读全局配置。
3. **配置中心**：provider / 模型 / 中转 baseUrl / 凭据 / skills / MCP 服务器 / 扩展，全部应用内管理。
4. **线性工作流**（类 Dify 简化版）：数据/脚本节点 → pi 节点 → 下游节点，pi 输出以结构化协议传递。

非目标（当前版本明确不做）：团队协作/云同步、远程执行器、多用户权限、RAG 知识库、可视化分支编排（M4 前不做）。

---

## 2. 技术裁决记录

| # | 裁决点 | 结论 | 日期 |
|---|--------|------|------|
| T1 | 不基于 vtools 开发 | 全新代码库。vtools 的经验资产（DshAgentService 进程管理模式、CT-1 日志脱敏、CT-2 持久化白名单、树杀/超时、mihomo 内核获取先例）作为**模式参照**，代码不复用（Rust→TS 无法移植） | 2026-09-10 |
| T2 | 技术栈选型 | **TypeScript + Electron + React（pnpm monorepo）**。评估全文见 §3；备选 Tauri v2；否决 Rust+egui / Go / Flutter | 2026-09-10 |
| T3 | pi 运行时分发 | **方案 B：内置分发**——按平台打包 pi 官方 standalone binary，锁版本 + sha256 清单，PATH 检测仅作开发模式回退 | 2026-09-10 |
| T4 | M3 工作流形态 | **单链路线**：Start → [Data\|Script\|PiAgent\|Transform]* → Output 顺序执行；无条件/并行/循环；编辑用有序节点列表 + 表单，**无画布**（画布属 M4） | 2026-09-10 |
| T5 | 应用内产品名 | `pidesk` 为占位名，待定 | 2026-09-10 |
| T6 | UI 基建与设计流程 | 组件库 **shadcn/ui**（Tailwind + Radix）+ react-markdown + React Flow + lucide；设计流程由 **frontend-design** skill（Anthropic 官方，agent/skill/frontend-design/，junction 接入）驱动，产物为 docs/ui-prototype-plan.md（令牌系统 + 反模板审查 + 分屏规格）；暗色石墨主题、蓝色仅限焦点语义、密度对齐 Wegent DESIGN.md。背景：vtools egui 手绘 UI 美观度问题，本项目 UI 禁止脱离令牌系统即兴绘制 | 2026-09-10 |
| T7 | 预置 provider 清单 | 预置 **本地 Ollama**（`http://127.0.0.1:11434/v1`，OpenAI 兼容端点）与**通用自定义 provider**（自定义 baseUrl，覆盖中转站场景，对齐 F8）；**不内置任何云端 provider 凭据**。背景：开发机已有 Ollama 部署（qwen3.8 27B/9B，2026-09-10 实测 52/121 tok/s），M1 验收零成本跑通 | 2026-09-10 |
| T8 | 代理集成时机 | clash 代理集成延后至 **M2**；M1 仅保留 `HTTP_PROXY`/`HTTPS_PROXY` env 注入位（§6.1 PiProcess env 装配不变），不做 clash 交互。开发链路不依赖代理：WSL→GitHub 版本库同步走 SSH over 443（ssh.github.com，HTTPS 主站按 SNI 阻断不受影响） | 2026-09-10 |
| T9 | 产品定名与仓库 | **定名 `pidesk`**（占位转正，不再更名）；仓库 `github.com/vacryleaf/pidesk`。包名 scope `@pidesk/*`，userData 目录名 `pidesk`，协议/IPC 字段前缀 `pidesk:` | 2026-09-10 |

---

## 3. 语言选型评估（三平台分发的通用性与可迁移性）

评估对象：本产品（Electron 类桌面壳 + pi 子进程编排 + 聊天流式 UI + 配置表单 + 线性工作流 + 后续画布）。

### 3.1 候选与结论

| 方案 | 结论 |
|------|------|
| **TS + Electron + React** | ✅ **推荐** |
| Rust + Tauri v2（web 前端） | 备选：体积有硬约束时启用 |
| Rust + egui（vtools 同栈） | 否决（本产品 UI 形态下成本过高） |
| Go + Fyne/Wails | 否决 |
| Flutter (Dart) | 否决 |

### 3.2 决定性依据（按权重排序）

**① 与 pi 的亲和度（权重最高）**
- pi 本体、扩展 API（`pi.registerTool` 等）、RPC 协议消息类型全是 TypeScript。应用必须自研 mcp-bridge / flow-bridge 两个 TS 扩展（见 §6.3）——**扩展和宿主同语言**，一个工具链、可共享类型与工具函数。
- Electron+TS 可直接 `import` pi 包导出的类型甚至工具代码（会话 JSONL 读取、协议类型），pi 演进时跟进成本最低。
- Rust 方案需手工维护协议/JSON 的 Rust 类型映射，pi 每次演进双层同步（vtools-ai 已体验过同类协议层成本）。

**② UI 复杂度匹配**
- 本产品 UI 大头：markdown 流式渲染、会话列表、配置表单、（M4）节点画布。Web 生态全部现成：`react-markdown` + streaming、React Flow（MIT，Dify 类画布专用库）。
- egui 需手写 markdown 渲染器（vtools-ai-ui 六要素渲染已是先例，成本已验证）、自研画布与表单，预估 UI 工作量 3~5 倍。

**③ 三平台分发成本**
- Electron：`electron-builder` 单配置产出 NSIS 安装包 / deb / AppImage / dmg；GitHub Actions matrix 成熟；无交叉编译工具链问题。
- Rust：三平台原生构建（macOS 签名/公证、Linux glibc 兼容矩阵），CI 可解但环节多。
- Tauri：体积最优，但 Linux webkitgtk 版本碎片是长期痛点；Rust 后端 + TS 前端双栈 IPC 桥，维护面介于两者之间。
- Go：交叉编译王者，但 GUI 短板（Fyne 非原生 + 富文本弱；Wails 又回到 webview），agent 工具链生态参考少。

**④ 可迁移性（"容易迁移"的直接回答）**
- Electron+TS：渲染层逻辑可平迁到 **Web 版**（对标 Wegent 的 Desktop/Web 双形态），主进程编排逻辑可平迁到服务端——产品演化路线不被锁死。
- egui 代码锁定桌面；Tauri 前端可迁移但 IPC 层需重写。

**⑤ 生态参照**
- Wegent wework（Electron + Vite + React + TS 驱动本地 coding agent）是**同形态产品的成功先例**，源码在工作区可直接参照。
- pi 官方文档、SDK 示例、RPC client 全部 TS。

### 3.3 诚实的代价清单（Electron 方案需接受）

| 代价 | 程度 | 缓解 |
|------|------|------|
| 体积/内存（安装包 ~100MB，运行 ~150-300MB） | 中 | 开发者工具可接受（VS Code/Cursor/Codex desktop/Wegent 同族）；无解，接受 |
| Windows Job Object 无原生 API（脚本节点隔离） | 低-中 | MVP 用 `taskkill /T` 树杀 + 超时；M5 可附带一个极小 Rust 辅助 exe 专职 Job Object 包裹（单一职责，不构成技术栈混合） |
| Electron 安全面（需关闭 nodeIntegration、启用 contextIsolation、preload 白名单 IPC） | 低 | electron-vite 模板 + 标准安全清单，立项时写入代码规范 |

**最终结论**：T2 裁决成立。若未来"单二进制 + 极致体积"成为硬需求，迁移出口是 Tauri v2（前端代码可保留），当前不为此提前支付双栈成本。

---

## 4. 关键技术事实（已对 pi 上游源码验证，规划基石）

| # | 事实 | 出处（pi 仓库） |
|---|------|----------------|
| F1 | `PI_CODING_AGENT_DIR` 覆盖 pi 整个配置目录（settings.json / auth.json / models.json / sessions/ / skills/ / extensions/ / trust.json） | docs/environment-variables.md、src/config.ts |
| F2 | `PI_CODING_AGENT_SESSION_DIR` / `--session-dir` 单独覆盖会话存储；会话按 cwd 分目录 JSONL | sessions.md、settings.md |
| F3 | `pi --mode rpc`：JSONL-over-stdio 全协议（prompt/steer/abort/new_session/set_model/get_messages/compact/get_session_stats/…）+ 流式事件（message_update、tool_execution_*、agent_end）；分帧只认 `\n`（通用 readline 不合规） | docs/rpc.md |
| F4 | **pi 无内置 MCP**（官方立场：靠 extension 扩展）→ 自研 mcp-bridge 扩展为必做项 | docs/usage.md |
| F5 | SDK（createAgentSession）仅 Node 宿主可用；Electron 主进程即 Node，**SDK 与 RPC 子进程两条路都通**（选型见 §6.1） | docs/sdk.md |
| F6 | 非交互模式按 `defaultProjectTrust` 处理项目信任（默认 ask = 静默忽略项目资源）→ 隔离 settings.json 必须显式设置 | docs/settings.md |
| F7 | pi MIT 许可 → 可捆绑分发（保留版权声明）；官方 standalone binary 六平台矩阵：darwin-arm64/x64、linux-x64/arm64、windows-x64/arm64（scripts/build-binaries.sh） | LICENSE、scripts |
| F8 | 凭据落 auth.json 或环境变量；models.json 支持自定义 baseUrl（中转场景） | src/config.ts、docs/custom-provider.md |
| F9 | 扩展可注册工具、拦截事件、appendEntry 持久化 → MCP 桥接与结构化输出的实现基础 | docs/extensions.md |

---

## 5. 总体架构

### 5.1 进程拓扑

```
pidesk (Electron 主进程, Node)
├── 渲染进程 (React)          ← 全部 UI；IPC 仅经 preload 白名单
├── pi RPC 子进程 ×N          ← 会话面板 / 工作流 pi 节点（隔离 env；并发池上限默认 4）
│   └── MCP server 子进程     ← 由 mcp-bridge 扩展在 pi 进程内 spawn，随 pi 退出
├── 脚本节点子进程            ← 树杀 + 超时包裹
└── 工作流 worker             ← 主进程内 async 队列（M3 单链无需独立进程）
```

### 5.2 monorepo 结构（pnpm workspace，参照 Wegent 根布局）

```
pidesk/
├── apps/desktop/            # Electron：main（编排）/ preload（IPC 白名单）
├── packages/
│   ├── ui/                  # React 渲染层：聊天面板 / 配置中心 / 工作流编辑 / 运行监视
│   ├── pi-host/             # pi 进程域：RPC 客户端、生命周期、隔离 env 装配、会话池
│   ├── config-center/       # 隔离目录域：settings/auth/models 生成、skills 安装、扩展分发
│   ├── flow-engine/         # 线性工作流：模型、执行器、变量存储、节点运行器
│   └── shared/              # 协议类型（PiEvent/FlowNode/…）、日志脱敏、持久化工具
├── extensions-src/          # 随应用分发的 pi 扩展（构建产物落隔离目录 extensions/）
│   ├── mcp-bridge/
│   └── flow-bridge/
└── resources/pi/            # 打包期注入的 pi standalone binary（按平台）+ sha256 清单
```

依赖方向：`desktop → ui → pi-host/flow-engine → shared`；config-center 被 pi-host 与 desktop 装配调用；UI 组件间互不引用。

---

## 6. 模块详设

### 6.1 pi-host：进程与会话管理

- **接入路线选型：RPC 子进程（F3），不用进程内 SDK（F5）**。理由：① 隔离要求每会话独立 env（`PI_CODING_AGENT_DIR` 是进程级），SDK 共进程无法按会话隔离；② 子进程崩溃不拖垮应用；③ 与 Wegent"工作台驱动执行器"同构。
- **PiProcess**：spawn `<resources>/pi/pi-<platform> --mode rpc`，注入：
  ```
  PI_CODING_AGENT_DIR          = app.getPath('userData')/pi-agent
  PI_CODING_AGENT_SESSION_DIR  = 默认 pi-agent/sessions；工作流 run 指定 run 目录
  HTTP_PROXY / HTTPS_PROXY     = 应用代理设置（预留 clash 集成位）
  VTOOLS_HOST 改名 PIDESK_HOST = 1（宿主标记）
  ```
- **RpcClient**：按 F3 分帧规则实现 JSONL（Buffer 按 `\n` 切分、容忍 `\r\n`）；请求 id 关联；事件解析为强类型 `PiEvent` 联合类型（TS 直接对齐上游）。
- **会话池**：面板会话各占一个 PiProcess；工作流 pi 节点按 §6.4 会话策略取用；并发上限 + 排队；空闲回收（默认 30min）；崩溃自动重启 + 会话恢复（switch_session 回文件）。
- **生命周期**：启动握手（首个 get_state 成功）；退出树杀；版本握手时校验 pi 版本与清单锁定版本一致，不一致告警。

### 6.2 config-center：配置中心（隔离目录唯一写入方）

隔离目录 `userData/pi-agent/`（F1），UI 覆盖：

| 管理项 | 落点 | 要点 |
|--------|------|------|
| Provider 凭据 | `auth.json` | 密码型输入；日志零落 key（脱敏管道对齐 vtools CT-1 经验）；可选"仅环境变量注入"不落盘 |
| 模型与中转 | `settings.json` + `models.json` | 默认模型/思考档位；自定义 provider baseUrl（中转站刚需，对齐 F8） |
| 项目信任 | `defaultProjectTrust` | 默认 `"never"`（工作流不被 cwd 项目配置劫持），显式可开 `"always"`（F6） |
| Skills | `skills/<name>/SKILL.md` | 应用内编辑/导入（文件夹/zip）；停用 = 移入 `skills-disabled/` |
| 扩展 | `extensions/` | 仅应用签名分发（§6.3）；用户自装列后续 |
| MCP | 应用自有 `mcp.json`（userData 白名单） | server 命令/args/env/传输编辑器；生效需重启对应 pi 进程或 bridge 重载 |

### 6.3 随应用扩展（extensions-src，pi 侧 TS）

- **mcp-bridge.ts**：读 `pi-agent/mcp-generated.json`（config-center 生成、带 schema 版本）→ 对每个 server 建连（官方 `@modelcontextprotocol/sdk`，stdio/SSE）→ `tools/list` 逐个 `pi.registerTool()` 包装（命名 `mcp__<server>__<tool>` 防冲突）→ 断线重连 + `extension_error` 上报；server 子进程随 pi 退出。
  - 立项先调研 pi packages 生态有无现成 MCP bridge，有则评估替代自研。
- **flow-bridge.ts**：注册 `flow_emit` 工具——pi 节点结构化输出协议（prompt 要求 pi 调用提交 JSON 结果，扩展 appendEntry 落会话文件；vtools-flow 端读取校验）。兜底：`get_last_assistant_text` + JSON 围栏解析（无扩展依赖）。

### 6.4 flow-engine：线性工作流（T4 裁决）

- **模型**：`Flow { id, name, nodes: Start → [Data | Script | FileRead | FileWrite | PiAgent | Transform]* → Output }`；JSON 持久化，纯模型可脱离 UI 测试。
- **变量系统**：Run 持有 `context: JSON`；节点 `inputs`（取值表达式）/ `outputs`（写回路径）；M3 用 JSON 值 + 可选 JSON Schema 校验。
- **执行**：单链顺序，逐节点；Run 可取消；失败即停（M3 不做重试/跳过）；Run 事件追加 `runs/<runId>.jsonl` 供回放。
- **节点执行器**：
  - Script：spawn shell/powershell，stdin 注入 context，stdout 捕获限长；`taskkill /T` + 超时（默认 300s/节点可配）；cwd 钉死 run 工作目录。
  - Data：走应用统一网络出口（fetch + 代理设置）；FileRead/Write 路径归一化校验，限定 run 目录。
  - PiAgent：prompt 模板（`{{context.x}}` 插值）+ 模型/思考档位 + **会话策略**（`isolated` 每节点新会话 / `shared:<key>` 同 key 续用会话多轮接力）+ 输出策略（flow_emit 首选 / 文本解析兜底）；完成判定 = `agent_end`；长流配置 compact + shared 会话轮次上限（超限 new_session + 摘要交接）。
- **成本可视**：pi `get_session_stats` 提供 tokens/cost，Run 汇总展示。

### 6.5 UI（packages/ui）

> 视觉与交互规格统一以 **docs/ui-prototype-plan.md** 为准（T6：shadcn/ui + 令牌系统，frontend-design skill 驱动），下表仅为分屏与里程碑索引。

| 面板 | M | 内容 |
|------|---|------|
| 聊天会话 | M1 | 多会话标签、markdown 流式（react-markdown）、工具调用卡片、模型/思考档位切换、compact、中止 |
| 配置中心 | M2 | 树形导航：凭据/模型/skills/MCP/扩展 |
| 工作流编辑 | M3 | 有序节点列表 + 每节点表单 + JSON 视图（**无画布**，T4） |
| 运行监视 | M3 | 链式步骤高亮、节点日志流、context inspector、失败重跑入口 |
| 画布 | M4 | React Flow 节点画布 + Condition 分支 |

---

## 7. 数据与持久化

```
userData/
├── pi-agent/                  # 隔离 pi 目录（唯一写入方 config-center / pi-host）
│   ├── settings.json / auth.json / models.json / trust.json
│   ├── sessions/  skills/  skills-disabled/  extensions/
│   └── mcp-generated.json
├── mcp.json                   # 应用侧 MCP 配置（用户编辑面）
├── flows/*.json               # 工作流定义
├── runs/<runId>.jsonl         # 运行事件流
└── app.json                   # 应用偏好（主题/代理/并发上限）
```

- 全部 JSON 写入走原子写（tmp+rename）+ 损坏回退（vtools CT-2 模式）。
- pi 会话 JSONL 增长管理：设置页提供隔离目录占用统计与会话清理入口。

## 8. 安全与资源边界

1. pi 无权限系统（官方立场）→ cwd 钉死 run/工作区目录；M5 可加 pi 扩展做 tool_call 路径黑名单拦截；文档明示边界。
2. 脚本节点：超时树杀必选；M5 评估 Rust 辅助 exe 包 Job Object（内存上限）。
3. 凭据/MCP env/订阅类 URL 零落日志；日志管道内置 redact 规则。
4. MCP server 配置 = 任意命令执行入口 → 导入时确认 + 风险明示。
5. 资源闸：pi 进程数（默认 4）、脚本并发、MCP server 数各自上限。
6. Electron 安全清单：contextIsolation + preload IPC 白名单 + 禁远程内容。
7. **双向隔离验收用例**（M1 出口）：全局 `pi -r` 看不到应用会话；应用会话面板看不到全局 skills/配置。

## 9. pi 运行时分发（T3 方案 B 详设）

- **来源**：pi 官方 release 的 standalone binary（六平台矩阵，F7）；构建脚本 `pi/scripts/build-binaries.sh` 可自行构建补充。
- **打包**：electron-builder `extraResources` 按目标平台注入 `resources/pi/pi[-.exe]` + `pi-manifest.json`（版本、sha256、上游 release 来源）。
- **启动校验**：sha256 比对失败 → 拒绝启动 pi 并指引；版本与锁定版本不一致 → 告警横幅。
- **升级策略**：pi 版本随应用版本锁定演进；升级 = 应用发版带新 binary + 回归清单（四项冒烟：RPC 握手/prompt 事件流/flow_emit/mcp-bridge）。
- **开发模式回退**：`PIDESK_PI_PATH` 环境变量或 PATH 检测，便于跟随 pi 上游调试。
- **合规**：pi 为 MIT（F7），打包附带其 LICENSE 与版权声明；应用不修改 pi 二进制。

## 10. 三平台打包矩阵

| 目标 | 产物 | pi binary | CI 备注 |
|------|------|-----------|---------|
| Windows x64 | NSIS 安装包 | pi-windows-x64 | 现有开发/实测平台 |
| Linux x64 | deb + AppImage | pi-linux-x64 | glibc 下限在 CI 固定（ubuntu 22.04） |
| macOS arm64/x64 | dmg（universal 或分架构） | pi-darwin-arm64 / x64 | 签名/公证随发布 mature 化，M1-M3 可先 unsigned + 文档说明 |

## 11. 里程碑

| 阶段 | 内容 | 出口标准 |
|------|------|----------|
| **M1 隔离底座** | monorepo 脚手架；pi-host（RPC/生命周期/隔离 env）；聊天面板 MVP；隔离目录最小 settings | 三平台可运行的单会话对话；双向隔离验收用例通过；Windows 实测交付 |
| **M2 配置中心** | config-center 全量；mcp-bridge / flow-bridge 扩展；skill 导入；代理设置传导 | 模型/凭据/中转/MCP/skill 全部应用内配置生效且重启持久 |
| **M3 线性工作流**（T4） | flow-engine 单链执行 + 五类节点 + 表单编辑 + 运行监视 + run 持久化 | 示例流"HTTP 拉数 → 脚本清洗 → pi 分析 → 写文件"全绿；可取消、失败重跑单节点 |
| **M4 画布 + 分支** | React Flow 画布 + Condition 节点 + shared 会话策略完善 | 可视化编排示例流 |
| **M5 发布打磨** | 三平台签名/公证；Job Object 辅助件评估；会话清理；流导入导出；回归清单固化 | 发布形态验收 |

## 12. 风险登记

| 风险 | 等级 | 对策 |
|------|------|------|
| pi RPC/extension API 无兼容承诺，升级即断 | 高 | 锁版本分发（T3）+ 四项冒烟回归 + 隔离目录记录 pi 版本 |
| mcp-bridge 自研维护面 | 中 | 先调研 pi packages 生态现成方案；桥接层薄封装隔离上游变化 |
| Electron 体积/内存 | 中 | 接受（§3.3）；不做预打包优化承诺 |
| 脚本节点隔离仅树杀级 | 中 | 边界钉死 + 文档明示；M5 Job Object 辅助件 |
| macOS 签名/公证链路 | 低 | M5 处理；前期 unsigned + 用户自放行 |
| 长工作流 token 成本 | 中 | 会话策略一等化 + compact + get_session_stats 成本可视 |

## 13. 待决问题（进入 M1 前需确认）

1. ~~产品定名（现占位 `pidesk`）与仓库位置。~~ → **已裁决 T9**（2026-09-10：定名 pidesk，仓库 github.com/vacryleaf/pidesk）
2. ~~默认 bundled 模型档位与预置 provider 清单（涉及中转 baseUrl 预设是否内置）。~~ → **已裁决 T7**（2026-09-10）
3. ~~M1 是否顺带把 clash 代理集成纳入（vtools 有现成经验；建议 M2 再议）。~~ → **已裁决 T8**（2026-09-10：延后 M2）
4. ~~是否接受 M1-M3 macOS 产物 unsigned。~~ → **已关闭**(2026-09-10:被 P3 吸收——macOS 产物延后 M5,与签名/公证议题合并处理)
