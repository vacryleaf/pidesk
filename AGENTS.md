# pidesk 开发协作规则

> 层级:product-plan.md(做什么)> dev-process.md(怎么流转)> 本文件(全局纪律)。
> 过程数据(快照/卡进度/教训)一律在 `docs/engineering/handoff.md`,不进本文件。

## 身份与语言

- 仓库属主 **harry**,主线程以 harry 运行,禁 sudo/su;检测到 root → 停止写操作,提示以 harry 重启会话。
- 永远中文:回复、注释、提交信息、文档。

## 两级 pi 架构

- **主线程**(编排):拆卡、派发、验收、集成、git 提交推送;不写实现代码(例外:E 阶段规划产物由主线程亲写)。
- **子线程**(执行):一律经 `scripts/dispatch.sh -t "<任务>" -v "<验收命令>"` 派发(返工加 `-c` 附问题清单),禁手工拼 pi 命令;会话隔离于 `/home/harry/.pi-worker`;禁 git、禁新增依赖、只改工作区。
- 同一卡 >3 轮失败 → 熔断升级用户(dev-process §8)。

## 任务卡纪律

- 子线程上下文 16k 为物理约束:超预算**拆卡**,不换大上下文(`-m 32k` 须报备理由)。
- **预消化**:install、版本实查、环境修复等大输出/确定性操作由主线程派发前完成;子线程卡只含"写码 + 单次验收",规格内联到照抄级,禁子线程探索性读 docs。
- 每卡:单一职责、1~3 实现文件、明确产出路径、验收命令作 `-v` 并 tail 截断。

## 验收红线

- DoD:编译过 → 读 diff 对照规格(**不得只跑测试**)→ 验收命令绿 → 无越范围改动。
- 提交:Conventional Commits 中文、一卡一 commit、main 直合;推后 CI 兜底。
- 提请用户验收必附验收包(`docs/acceptance/mX-acceptance.md`);UI 偏离 ui-prototype 令牌系统即打回;可用性红线:新用户不看文档能完成核心操作;涉 pi 协议须对照上游 docs 核实。

## 依赖报备制

仅必须时引入;**无需批准但必须告知**:登记 `docs/DEPENDENCIES.md` + 验收汇报列明;子线程禁自行引入。

## 会话恢复(新主线程按序读)

1. `docs/engineering/handoff.md`(快照 + 卡进度 + 教训) → 2. `docs/product-plan.md` → 3. `docs/engineering/dev-process.md` → 4. `docs/engineering/decisions.md` → 5. `docs/engineering/` 三产物 → 6. `git log --oneline -15`。

## 要点速查

- 裁决:product-plan §2(T1-T9)+ dev-process 文末(P1-P5)+ decisions.md(DR-001 类型方案A、DR-002 超时/退出兜底)。
- 技术栈:`docs/engineering/m1-design.md` §1(Electron 44 + React 19 + TS 5.9;pi 类型 devDep 0.85.1)。
- 环境:WSL Ubuntu(harry);仓库 `/home/harry/pidesk`;pi 0.85.1 `/usr/local/bin/pi`;Ollama `localhost:11434`;git 推送 SSH over 443;Windows 经 `\\wsl.localhost\Ubuntu\home\harry\pidesk`。
