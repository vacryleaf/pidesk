# pidesk 开发协作规则

> 本文件由 pi 主线程与所有子线程自动加载,是本仓库的开发纪律。与 `docs/product-plan.md` 冲突时,以 product-plan.md 为准。

## 语言纪律

**永远使用中文**:回答、注释、提交信息、文档,一律中文。

## 角色分工(两级 pi 架构)

- **主线程**:负责任务拆解、派发、验收、集成、git 提交推送。**不直接写实现代码**。
- **子线程**(开发执行者):由主线程按以下模板启动,执行单一细分任务:

  ```bash
  cd /root/pidesk && PI_CODING_AGENT_DIR=/root/.pi-worker \
    pi -p --model "ollama/qwen3.8-9b-coder:128k" "<细分任务描述>"
  ```

  - 返工时追加 `--continue` 续接原会话,带具体问题清单(文件+行级问题+原始报错)。
  - 子线程配置/会话隔离于 `/root/.pi-worker/`,与主线程互不可见(同时是 pidesk 产品隔离机制的演练);会话记录可供主线程审查工具调用过程。
  - 子线程**不做 git 提交**,只改工作区;提交由主线程验收后统一执行。

## 任务拆分原则(主线程)

1. 每个子任务:单一职责、独立可验收、范围 1~3 个文件、有明确产出路径与完成标准。
2. 派发信息必须自包含:目标、涉及文件、约束(引用本文件与 docs/)、验收标准(**必须含验收命令**,如 `node x.test.ts` / `pnpm build`,避免环境差异返工)。
3. 明确要求子线程"**调用 write/edit 工具落盘文件**",禁止只把代码贴在回复里(小模型高频失误,冒烟测试已踩坑)。
4. 禁止开放式大任务;宁可多轮小步。

## 验收流程(主线程)

1. 子线程完成后**必须实际验证**:读 diff、跑构建、跑测试、逐条对照验收标准。
2. **不通过** → 整理文件+行级问题清单,派回子线程返工;禁止主线程自己动手修。
3. **通过** → 主线程统一提交(Conventional Commits,中文描述)并推送。
4. 红线:编译必须过;不引入规划外依赖;UI 改动必须符合 `docs/ui-prototype-plan.md` 令牌系统;涉及 pi 协议(RPC/扩展)必须对照上游 docs 核实。

## 项目要点速查

- 权威规划:`docs/product-plan.md`(裁决 T1-T8);UI 规格:`docs/ui-prototype-plan.md`。
- 技术栈:TypeScript + Electron + React(pnpm monorepo);pi 运行时方案 B(standalone binary 锁版本)。
- 开发机:WSL 里 pi 0.85.1(`/usr/local/bin/pi`);Ollama 在 `localhost:11434`(Windows 宿主,镜像网络);git 推送走 SSH over 443。
