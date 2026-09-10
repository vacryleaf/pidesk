/**
 * Toast(T10c)—— 右下角轻提示:3s 自散,多条堆叠。
 * - ToastHost:纯呈现,接收 toasts 列表渲染堆叠区域。
 * - useToasts:本地 toast 队列小 hook,push 后 3s 自动移除。
 * 视觉:text-0 13px、bg-2 底、hairline 边;固定在右下角,不阻塞点击。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** 单条 toast:id 供 key/移除定位,text 为提示文案 */
export type Toast = { id: string; text: string };

/** toast 存活时长(ms):3s 自散 */
export const TOAST_TTL_MS = 3000;

/**
 * ToastHost —— 右下角堆叠容器。
 * pointer-events-none 让空区域透明,不遮挡底层交互;固定定位实心层仍可选中文本。
 */
export function ToastHost({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div
      data-testid="toast-host"
      className="pointer-events-none fixed bottom-3 right-3 flex flex-col items-end gap-1"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="pointer-events-auto rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] px-3 py-2 text-[13px] text-[var(--text-0)] shadow-[var(--shadow-lg)]"
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/** useToasts 返回值:toasts 当前列表,push 追加一条并在 3s 后自动移除 */
export type UseToastsResult = {
  toasts: Toast[];
  push(text: string): void;
};

/**
 * useToasts —— 本地 toast 队列:push 自动 3s 移除。
 * 序号用 ref 自增,避免同一毫秒内多次 push 产生重复 id;卸载时清理全部计时器。
 */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seqRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const push = useCallback((text: string) => {
    const id = `toast-${seqRef.current++}`;
    setToasts((prev) => [...prev, { id, text }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
    timersRef.current.push(timer);
  }, []);

  // 卸载兜底:清掉在途计时器,避免卸后 setState
  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    },
    [],
  );

  return { toasts, push };
}
