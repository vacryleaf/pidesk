# pidesk 开发协作规则

> 层级:product-plan.md(做什么)> dev-process.md(怎么流转)> 本文件(日常纪律)。冲突时修订下游并对齐。

## 身份与语言

- 仓库属主 **harry**,主线程以 harry 运行,禁 sudo/su;检测到 root → 停止写操作,提示以 harry 重启会话。
- 永远中文:回复、注释、提交信息、文档。

## 两级 pi 架构

- **主线程**(编排):拆卡、派发、验收、集成、git 提交推送;不写实现代码(例外:E 阶段规划产物由主线程亲写)。
- **子线程**(执行):一律经 `scripts/dispatch.sh -t "<任务>" -v "<验收命令>"` 派发(返工加 `-c` 附问题清单),禁手工拼 pi 命令;会话隔离于 `/home/harry/.pi-worker`(已关 AGENTS.md/skills/模板注入,thinking off);禁 git、禁新增依赖、只改工作区。
- 同一卡 >3 轮失败 → 熔断升级用户(详 dev-process §8)。

## 任务卡纪律(16k 是物理约束)

- 子线程上下文 16k:静态 ~4.5k(系统提示+注入+任务卡),动态余量 ~10k;超预算**拆卡**,不换大上下文(`-m 32k` 须报备理由)。
- **预消化**:install、版本实查、环境修复等大输出/确定性操作由主线程派发前完成;子线程卡只含"写码 + 单次验收";任务卡自包含(规格内联到照抄级,禁子线程探索性读 docs)。
- 每卡:单一职责、1~3 实现文件、明确产出路径、验收命令作 `-v`(一律 `2>&1 | tail -20` 截断)。

## 验收红线

- DoD:编译过 → 读 diff 对照规格(**不得只跑测试**)→ 验收命令绿 → 无越范围改动。
- 提交:Conventional Commits 中文、一卡一 commit、main 直合;推后 CI 兜底。
- 提请用户验收必附验收包(`docs/acceptance/mX-acceptance.md`);UI 偏离 ui-prototype 令牌系统即打回;可用性红线:新用户不看文档能完成核心操作;涉 pi 协议须对照上游 docs 核实。

## 依赖报备制

仅必须时引入;**无需批准但必须告知**:登记 `docs/DEPENDENCIES.md` + 验收汇报列明;子线程禁自行引入。

## 会话恢复(新主线程按序读)

1. `docs/product-plan.md` → 2. `docs/engineering/dev-process.md` → 3. `docs/engineering/decisions.md` → 4. `docs/engineering/`(pi-protocol/m1-design/m1-tasks) → 5. `git log --oneline -15` → 6. 下方快照。

## 交接快照(每次交接/里程碑必更新)

- **阶段**:M1 编码中——T1(workspace+shared)按预消化模式重做。
- **已完成**:E 详设全部过环节一(pi-protocol v1.0;m1-design v1.0 裁决:M1 单连接、dev 数据目录 `<仓库根>/.pidesk-dev`);m1-tasks **v1.1**(14 卡:T1~T13 含 T10a/b;T5/T6 对调——env 装配是状态机前置;外部评审四条吸收)。
- **T1 状态**:四次派发失败,根因闭环 = 16k 临界 × pi 0.85.1 compaction bug(压缩即崩);盘上有第 4 次会话半成品(根配置 8 文件 + shared 2 源文件)待核验复用。
- **下一步**:T1 预消化(核验→补齐→install→派最小卡)→ 按序 T2+。
- **教训固化**:长输出命令必须 tail 截断;pi 16k 临界区是雷区;主线程 bash 工具超时 ≤60s,长任务 `setsid` 后台+轮询;可用 pnpm 在 `~/.npm-global/bin`(PATH 内的可能损坏)。

## 要点速查

- 裁决:product-plan §2(T1-T9)+ dev-process 文末(P1-P5)+ decisions.md(DR-001 类型方案A、DR-002 超时/退出兜底)。
- 技术栈:`docs/engineering/m1-design.md` §1(Electron 44 + React 19 + TS 5.9;pi 类型 devDep 0.85.1)。
- 环境:WSL Ubuntu(harry);仓库 `/home/harry/pidesk`;pi 0.85.1 `/usr/local/bin/pi`;Ollama `localhost:11434`;git 推送 SSH over 443;Windows 经 `\\wsl.localhost\Ubuntu\home\harry\pidesk`。
