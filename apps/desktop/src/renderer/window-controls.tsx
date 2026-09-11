// 自绘窗口控制按钮(最小化/最大化/关闭):配合无边框窗口,经 window.pidesk 白名单桥调主进程。
// 浏览器环境无 bridge 时按钮 no-op;图标切换跟随窗口最大化状态(挂载与 resize 时同步)。
import { useEffect, useState } from "react";

/** 12px 线性图标(内联 SVG,desktop 未依赖 lucide-react) */
const iconProps = {
  width: 12,
  height: 12,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const MinusIcon = () => (
  <svg {...iconProps}>
    <path d="M5 12h14" />
  </svg>
);
const SquareIcon = () => (
  <svg {...iconProps}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </svg>
);
const CopyIcon = () => (
  <svg {...iconProps}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
const XIcon = () => (
  <svg {...iconProps}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const btnClass =
  "flex h-[26px] w-[38px] shrink-0 items-center justify-center border-0 bg-transparent p-0 text-[var(--text-1)]";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const bridge = typeof window !== "undefined" ? window.pidesk : undefined;

  const refresh = () => {
    bridge?.windowGetState().then((r) => setMaximized(r.maximized)).catch(() => {});
  };

  useEffect(() => {
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, []);

  return (
    <div
      data-testid="window-frame-controls"
      className="titlebar-no-drag flex h-[26px] shrink-0 items-center"
    >
      <button
        type="button"
        aria-label="最小化"
        className={btnClass}
        onClick={() => bridge?.windowMinimize().catch(() => {})}
      >
        <MinusIcon />
      </button>
      <button
        type="button"
        aria-label="最大化/还原"
        className={btnClass}
        onClick={() =>
          bridge
            ?.windowToggleMaximize()
            .then((r) => setMaximized(r.maximized))
            .catch(() => {})
        }
      >
        {maximized ? <CopyIcon /> : <SquareIcon />}
      </button>
      <button
        type="button"
        aria-label="关闭"
        className={btnClass}
        onClick={() => bridge?.windowClose().catch(() => {})}
      >
        <XIcon />
      </button>
    </div>
  );
}
