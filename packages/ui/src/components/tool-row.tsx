import { useState } from "react";
import { Wrench } from "lucide-react";

/** 工具调用状态:运行中 / 成功 / 失败 */
export type ToolRowStatus = "running" | "ok" | "err";

/**
 * ToolRow —— 工具调用可折叠过程行(hairline 分隔,非卡片):
 * 图标(Wrench 16px)+ 工具名 + 参数预览(mono 12px)+ 状态。
 * running = 呼吸点(animate-pulse,focus 蓝);ok = ✓ + 耗时(ok 绿);
 * err = err 红,可展开 stderr 块(mono 12px,pre,bg-2,无阴影)。
 */
export function ToolRow({
  toolName,
  argsPreview,
  status,
  durationMs,
  stderr,
}: {
  toolName: string;
  argsPreview?: string;
  status: ToolRowStatus;
  durationMs?: number;
  stderr?: string;
}) {
  // 仅 err 态可展开查看 stderr
  const [open, setOpen] = useState(false);

  /* 状态节点:三态样式各归其色,focus 蓝仅表运行中焦点语义 */
  let statusNode: React.ReactNode;
  if (status === "running") {
    statusNode = (
      <span data-status="running" className="inline-flex items-center gap-1 text-[12px] text-[var(--text-1)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--focus)]" />
        运行中
      </span>
    );
  } else if (status === "ok") {
    statusNode = (
      <span data-status="ok" className="text-[12px] text-[var(--ok)]">
        ✓{durationMs != null ? ` ${durationMs}ms` : ""}
      </span>
    );
  } else {
    statusNode = (
      <button
        type="button"
        data-status="err"
        onClick={() => setOpen(!open)}
        className="cursor-pointer text-[12px] text-[var(--err)]"
      >
        {open ? "▾" : "▸"} 出错
      </button>
    );
  }

  return (
    <div className="mt-1 px-2 py-1">
      {/* 折叠行主体:图标 + 工具名 + 参数预览 + 右侧状态 */}
      <div className="flex items-center gap-2">
        <Wrench size={16} strokeWidth={1.5} className="shrink-0 text-[var(--text-1)]" />
        <span className="text-[13px] text-[var(--text-0)]">{toolName}</span>
        {argsPreview != null && (
          <span className="truncate font-mono text-[12px] text-[var(--text-2)]">{argsPreview}</span>
        )}
        <span className="ml-auto shrink-0">{statusNode}</span>
      </div>
      {/* err 态展开的 stderr 块:mono 12px,pre 保格式 */}
      {open && status === "err" && stderr != null && (
        <pre className="mt-1 whitespace-pre-wrap rounded-[8px] bg-[var(--bg-2)] p-2 font-mono text-[12px] leading-[1.5] text-[var(--err)]">
          {stderr}
        </pre>
      )}
    </div>
  );
}
