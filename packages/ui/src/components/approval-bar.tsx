/**
 * ApprovalBar(T10c)—— 审批条:固着在输入框上方(不弹窗)。
 * 结构 = 风险摘要文本 + [批准](focus 蓝主按钮)/[拒绝](中性次按钮)两按钮。
 * 本组件纯受控:审批请求的推送与答复由 main 侧 T11a 接线,呈现挂点由 T11 联调卡接。
 */

/** ApprovalBar props:summary 为风险摘要,两个按钮回调由上层接管答复 */
export type ApprovalBarProps = {
  summary: string;
  onApprove(): void;
  onReject(): void;
};

/**
 * ApprovalBar —— 风险摘要 + 批准/拒绝。
 * 视觉:bg-2 底 + hairline 边;批准=focus 蓝主按钮,拒绝=中性次按钮;无渐变无阴影。
 */
export function ApprovalBar({ summary, onApprove, onReject }: ApprovalBarProps) {
  return (
    <div
      data-testid="approval-bar"
      className="flex shrink-0 items-center gap-2 rounded-[12px] bg-[var(--bg-2)] p-2 shadow-[var(--shadow-md)] ring-1 ring-[var(--hairline)]"
    >
      {/* 风险摘要:占满剩余宽度,超长省略 */}
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-0)]" title={summary}>
        {summary}
      </span>
      {/* 批准:focus 蓝主按钮,文字取深底保证对比度 */}
      <button
        type="button"
        onClick={onApprove}
        className="h-7 shrink-0 rounded-[8px] bg-[var(--text-0)] px-3 text-[13px] text-[var(--bg-1)]"
      >
        批准
      </button>
      {/* 拒绝:中性次按钮 */}
      <button
        type="button"
        onClick={onReject}
        className="h-7 shrink-0 rounded-[8px] bg-[var(--bg-3)] px-3 text-[13px] text-[var(--text-0)]"
      >
        拒绝
      </button>
    </div>
  );
}
