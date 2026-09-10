/**
 * Placeholder —— 占位页:主区居中显示 "<title>(后续里程碑)"。
 * 供 T2c 导航壳各页使用,后续里程碑替换为真实页面。
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[13px] text-[var(--text-1)]">
        {title}(后续里程碑)
      </p>
    </div>
  );
}
