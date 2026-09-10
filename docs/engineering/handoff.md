# 交接与过程档案(handoff)

> 过程数据唯一落点:交接快照、卡进度、教训复盘。每次合卡/交接必更新本文件;AGENTS.md 只放全局纪律,不放过程。
> 新主线程会话恢复:先读本文件,再按 AGENTS.md「会话恢复」顺序补齐上下文。

---

## 交接快照

- **阶段**:M1 编码中——T1 已合入,下一卡 T2c。
- **已完成**:E 详设全部过环节一(pi-protocol v1.0;m1-design v1.0,环节一裁决:M1 单连接、dev 数据目录 `<仓库根>/.pidesk-dev`);m1-tasks v2.0(26 卡:剩余全部 16k、最小粒度拆分,每卡含主线程前置段)。
- **卡进度**:T1 ✅ `5e1e6bb`(workspace 根 + @pidesk/shared:typecheck 零错、test 6/6、build 产物齐);T2a ✅ `18df3a2`、T2b ✅ `d28f90b`;T2c~T13b 共 23 张待派(顺序见 m1-tasks §0 总表)。
- **下一步**:T2c(renderer 导航壳与占位页);前置=内联 ui-prototype §2.3/§2.1。
- **工具链偏差待记 DR**:electron-vite5 peer 限 vite ^7(m1-design §1 写 vite 8.2.2 不兼容)→ 实配 vite 7.3.6 + plugin-react 5.1.4(6.x 要 vite8);T2b 合入时已落,DR 与 m1-design §1 修订待办。

## 教训固化(当前生效的派发环境事实)

1. 长输出命令一律 `2>&1 | tail -20` 截断(16k 上下文刚性)。
2. pi 0.85.1 compaction 路径有 bug:被动压缩即崩——绝不把会话逼到上下文临界。
3. 量化模型 thinking 随机失控(实测单条 39k 字符):`/home/harry/.pi-worker/models.json` 已强制 `reasoning_effort=none`(samplingParams+thinkingLevelMap 双保险)并声明真实 `contextWindow/maxTokens`——**勿回退**;实验依据:Ollama OpenAI 端点支持该参数,`chat_template_kwargs` 无效。
4. 主线程 bash 工具超时上限 60s;长任务 `setsid nohup ... &` 后台化 + 轮询会话 JSONL 行数。
5. 可用 pnpm 在 `~/.npm-global/bin`(PATH 内的 pnpm 可能损坏);dispatch.sh 已写死。
6. 子线程禁探索性读 docs:任务卡必须自包含,规格内联到照抄级。

## T1 复盘摘要(2026-09-10)

四连败根因链:16k 临界(AGENTS.md 注入 + 随机长 thinking + install 长输出)→ Ollama error/length → pi compaction 崩溃。修复组合:AGENTS.md 瘦身并 `-nc/-ns/-np` 断开子线程注入、dispatch 注入压缩 + 输出截断硬纪律、预消化模式(install/版本实查由主线程完成)、reasoning_effort=none。第五次(最小卡 0.8k token)2.5 分钟通过。
