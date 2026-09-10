# pidesk — 基于 pi 的桌面 AI 工作台（规划中）

> 项目名 `pidesk` 为占位命名，可随时更名；更名时须同步 WORKSPACE_INDEX.md 与 WORKSPACE_KNOWLEDGE_BASE.md。

一个独立桌面应用（非 vtools 衍生）：底层以 **pi**（@earendil-works/pi-coding-agent）为 AI 执行引擎，对标 Wegent Desktop 的产品形态，外加类 Dify 的简易工作流。

核心目标：

1. **pi 会话完全由应用托管**——通过 `PI_CODING_AGENT_DIR` 等隔离机制，应用内 pi 的会话、配置、skills、MCP、凭据与全局 pi 双向不可见。
2. **配置中心**——provider/模型/中转 base URL/凭据/skills/MCP 全部在应用内管理。
3. **线性工作流**——脚本/数据节点 → pi 节点 → 下游节点，pi 处理结果以结构化协议传递给下一节点。

## 当前状态

**设计中（S1 规划阶段）**，尚未开始编码。

- 权威规划文档：[docs/product-plan.md](docs/product-plan.md)
  - 含技术裁决（语言选型、pi 运行时分发方案、M3 线性化）、模块详设、里程碑、风险登记。
- 关键裁决速查：
  - 技术栈：**TypeScript + Electron + React**（pnpm monorepo）——评估结论，详见 product-plan.md §2/§3；
  - pi 运行时：**方案 B 内置分发**——按平台打包官方 standalone binary（六平台矩阵均有官方产物），锁版本 + sha256；
  - M3 工作流：**单链路线**（Start → 节点序列 → Output），无条件/并行分支，画布延后到 M4。

## 参考项目（工作区内克隆，只读参考）

| 目录 | 用途 |
|------|------|
| `../pi` | 执行引擎上游源码：RPC 协议（rpc.md）、隔离环境变量、扩展 API、standalone binary 构建 |
| `../Wegent` | 桌面工作台产品参照（wework/：Electron + React 驱动本地 coding agent） |
| `../dify` | 工作流产品形态参照（节点/变量/编排交互） |

## 目录结构

    pidesk/
    ├── README.md                # 本文件
    └── docs/
        └── product-plan.md     # S1 产品与架构规划（唯一权威规划文档）
