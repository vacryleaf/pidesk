/**
 * ModelMenu(T11c)—— 输入区左下角模型/思考切换菜单(视觉对齐 Wegent §6.4/§6.1)。
 * - 触发器:静默 text-sm 文本钮,显示 `provider/model:thinking`,模型 id 走 mono(等宽仅限代码数据)。
 * - 弹层:打开时经 listModels 拉取;按 provider 分组平铺(Name + id),当前项用中性 bg-3 选中态。
 * - 选中模型 → onSetModel(provider,modelId);思考档位子列表按固定顺序过滤可用项 → onSetThinkingLevel(level)。
 * - 空态:列表为空 → 「无可用模型,请在配置中设置连接」;拉取失败 → 同样的空态位展示错误文案。
 * - 视觉走令牌:12px 圆角 + bg-1 + ring/hairline + lg 阴影;数据拉取全部经 props 注入以便测试。
 */
import { useEffect, useRef, useState } from "react";

/** 模型信息(结构对齐 shared/ipc.ts 的 ModelInfo;ui 包不依赖 shared,按最小形状声明) */
export type ModelInfo = {
  provider: string;
  modelId: string;
  name?: string;
  thinkingLevels?: string[];
};

/** 档位固定展示顺序:仅渲染 ModelInfo.thinkingLevels 中存在的项 */
const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type ModelMenuProps = {
  provider: string;
  modelId: string;
  thinkingLevel: string;
  onSetModel(provider: string, modelId: string): void;
  onSetThinkingLevel(level: string): void;
  listModels(): Promise<ModelInfo[]>;
};

/** 按 provider 分组并保持原始顺序(分组仅在渲染层,便于视觉区隔) */
function groupByProvider(models: ModelInfo[]): Array<[string, ModelInfo[]]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const list = groups.get(model.provider);
    if (list) list.push(model);
    else groups.set(model.provider, [model]);
  }
  return Array.from(groups.entries());
}

/**
 * ModelMenu —— 受控展示当前 provider/model:thinking,弹层内切换模型与思考档位。
 * 弹层内已点选的模型优先于 props(父层受控回写前即时反映),并据此刷新档位子列表。
 */
export function ModelMenu({
  provider,
  modelId,
  thinkingLevel,
  onSetModel,
  onSetThinkingLevel,
  listModels,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 本次弹层内点选的模型:非空时优先于 props
  const [picked, setPicked] = useState<{ provider: string; modelId: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 当前生效的模型:弹层已点选优先,否则用 props
  const curProvider = picked?.provider ?? provider;
  const curModelId = picked?.modelId ?? modelId;

  // 打开时拉取模型列表(每次打开重置点选与错误态)
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setError(null);
    let cancelled = false;
    void listModels()
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModels([]);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, listModels]);

  // 打开期间:Escape 与点击组件外关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    const onDown = (ev: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // 当前模型的可用档位:按固定顺序过滤
  const currentModel = models.find(
    (m) => m.provider === curProvider && m.modelId === curModelId,
  );
  const levels = THINKING_ORDER.filter((lv) => (currentModel?.thinkingLevels ?? []).includes(lv));

  /** 选中模型:先本地记录(即时刷新档位),再回调父层 */
  const handleSelectModel = (m: ModelInfo) => {
    setPicked({ provider: m.provider, modelId: m.modelId });
    onSetModel(m.provider, m.modelId);
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      {/* 触发器:静默文本钮,provider/ + mono 模型 id + :thinking */}
      <button
        type="button"
        data-testid="model-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1 px-1 text-[13px] text-[var(--text-1)]"
      >
        {curProvider && curModelId && curProvider !== "unknown" && curModelId !== "unknown" ? (
          <>
            <span>{curProvider}/</span>
            <span className="font-mono">{curModelId}</span>
            <span>:{thinkingLevel}</span>
          </>
        ) : (
          <span>选择模型</span>
        )}
      </button>

      {open && (
        <div
          data-testid="model-menu-popover"
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-1 w-[280px] rounded-[var(--radius-menu)] bg-[var(--bg-1)] p-1 shadow-[var(--shadow-lg)] ring-[0.5px] ring-[var(--ring)]"
        >
          {models.length === 0 ? (
            // 空态 / 拉取失败:同一位置给出可操作提示
            <div data-testid="model-menu-empty" className="px-2 py-3 text-[12px] text-[var(--text-1)]">
              {error ? `读取模型失败:${error}` : "无可用模型,请在配置中设置连接"}
            </div>
          ) : (
            <>
              {/* 模型列表:provider 分组,当前项用中性 bg-3 选中态 */}
              {groupByProvider(models).map(([p, list]) => (
                <div key={p}>
                  <div className="px-2 py-1 text-[12px] text-[var(--text-1)]">{p}</div>
                  {list.map((m) => {
                    const active = m.provider === curProvider && m.modelId === curModelId;
                    return (
                      <button
                        key={`${m.provider}/${m.modelId}`}
                        type="button"
                        role="menuitemradio"
                        data-testid="model-menu-item"
                        data-active={active}
                        aria-checked={active}
                        onClick={() => handleSelectModel(m)}
                        className={
                          "flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1 text-left " +
                          (active ? "bg-[var(--bg-3)]" : "")
                        }
                      >
                        <span className="flex-1 truncate text-[14px] text-[var(--text-0)]">
                          {m.name ?? m.modelId}
                        </span>
                        {m.name && (
                          <span className="font-mono text-[12px] text-[var(--text-1)]">
                            {m.modelId}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* 档位子列表:从当前 ModelInfo.thinkingLevels 过滤,无可用档位则不显示 */}
              {levels.length > 0 && (
                <div
                  data-testid="model-menu-levels"
                  className="mt-1 border-t border-[var(--hairline)] pt-1"
                >
                  <div className="px-2 py-1 text-[12px] text-[var(--text-1)]">思考档位</div>
                  {levels.map((lv) => {
                    const active = lv === thinkingLevel;
                    return (
                      <button
                        key={lv}
                        type="button"
                        role="menuitemradio"
                        data-testid="thinking-item"
                        data-active={active}
                        aria-checked={active}
                        onClick={() => {
                          onSetThinkingLevel(lv);
                          setOpen(false);
                        }}
                        className={
                          "flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1 text-left " +
                          (active ? "bg-[var(--bg-3)]" : "")
                        }
                      >
                        <span className="font-mono text-[14px] text-[var(--text-0)]">{lv}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
