/**
 * 版本预检(T5b):spawn 前的 pi 二进制解析与版本比对。
 * 语义(已定版):
 * - 二进制解析序:①env.PIDESK_PI_PATH 非空→用之;②PATH 中找 pi;③都无→抛错。
 *   本层零文件系统读取:PATH 查找由宿主注入 findInPath 完成(默认 null=未找到),
 *   保持纯可测、不在单测里依赖真 pi。
 * - 版本预检:跑独立短进程 <binary> --version(execFile,10s 超时),
 *   trim 后与期望版本比对;不匹配仅告警(回调),不阻断。
 * - 解析/执行失败(退出码非 0、超时、进程错误)→ 抛错。
 */

import { execFile, type ExecFileException } from "node:child_process";

/** 回调风格执行器(execFile 的最小结构类型):便于测试注入 fake,避开 mock 纠缠 */
type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { timeout?: number; maxBuffer?: number },
  callback: (err: ExecFileException | null, stdout: string, stderr: string) => void,
) => unknown;

/** 版本检查返回结构 */
export interface VersionCheckResult {
  /** 实际解析到的二进制路径 */
  binary: string;
  /** --version 输出(trim 后) */
  version: string;
  /** 与期望版本是否一致 */
  match: boolean;
}

/** 版本比对不匹配时的告警回调(开发模式不阻断) */
export type VersionWarnListener = (info: {
  binary: string;
  expected: string;
  actual: string;
}) => void;

/**
 * 解析 pi 二进制路径(按解析序)。
 * @param env 环境变量(通常取 process.env 或 buildPiEnv 的超集)
 * @param findInPath 宿主注入的 PATH 查找器:返回二进制绝对路径,未找到返回 null。
 *        默认 null(测试与纯逻辑调用);宿主通常传
 *        (name) => env.PATH?.split(":").map(p => join(p, name)).find(existsSync) 之类的实现。
 */
export function resolvePiBinary(
  env: NodeJS.ProcessEnv,
  findInPath: (name: string) => string | null = () => null,
): string {
  // ① env.PIDESK_PI_PATH 非空优先
  const forced = env.PIDESK_PI_PATH;
  if (forced && forced.trim() !== "") return forced;

  // ② PATH 中找 pi
  const found = findInPath("pi");
  if (found) return found;

  // ③ 都无 → 抛错,信息指引设置 PIDESK_PI_PATH
  throw new Error(
    "未找到 pi 二进制:请在环境变量 PIDESK_PI_PATH 中指定 pi 可执行文件的绝对路径,或将 pi 加入 PATH",
  );
}

/**
 * 对已解析的二进制跑 <binary> --version 并与期望版本比对。
 * - execFile 独立短进程,10s 超时(超时按失败处理,抛错);
 * - 退出码非 0 / 进程级错误 → 抛错;
 * - trim 后比对,不匹配 → 仅触发 onWarn 回调,不阻断。
 * @param binary 二进制路径
 * @param expected 期望版本,如 "0.85.1"
 * @param onWarn 不匹配时的告警回调(可选)
 * @param injectExec 依赖注入:子进程执行器,默认真 execFile;
 *        测试传 fake,避免 mock node:child_process(hoisting/展开引发的异常调用)。
 */
export function checkPiVersion(
  binary: string,
  expected: string,
  onWarn?: VersionWarnListener,
  injectExec: ExecFileLike = execFile,
): Promise<VersionCheckResult> {
  return new Promise((resolve, reject) => {
    injectExec(
      binary,
      ["--version"],
      { timeout: 10_000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        // 超时时 err.killed=true 或超时信号;执行类错误统一抛错,不走告警路径
        if (err) {
          const msg =
            (err as NodeJS.ErrnoException & { killed?: boolean }).killed ||
            (err as NodeJS.ErrnoException & { signal?: string }).signal === "SIGTERM"
              ? `pi --version 执行超时(>10s): ${binary}`
              : `pi --version 执行失败(${binary}): ${err.message}`;
          reject(new Error(msg));
          return;
        }
        const version = stdout.trim();
        const match = version === expected;
        if (!match && onWarn) {
          onWarn({ binary, expected, actual: version });
        }
        resolve({ binary, version, match });
      },
    );
  });
}
