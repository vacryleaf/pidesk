/**
 * ConfigCenter(M2)—— 整页配置中心第一版:左侧树形导航 + 模型/凭据管理 + 代理设置。
 * - 数据经 window.pidesk.config* 真实 IPC;ui 不依赖 @pidesk/shared,按结构最小声明桥类型。
 * - Skills 为占位空态(M2 后续卡片接入);MCP 已接入配置 IPC。
 * - 全部 Wegent 令牌 CSS 变量;无 hover / cursor(项目全局 cursor default)。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ToastHost, useToasts } from "../components/toast";

// ---------- 桥数据类型(结构对齐 shared/ipc.ts,ui 内最小声明) ----------

export type ProviderPreset = "ollama" | "custom-openai";
export type ProviderModel = { id: string; name?: string };

export type ProviderProfile = {
  id: string;
  name: string;
  preset: ProviderPreset;
  baseUrl: string;
  models: ProviderModel[];
  defaultModelId?: string;
  saveKey: boolean;
  enabled: boolean;
};

export type SkillInfo = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  hasSkillFile: boolean;
};

export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
};

export type AppPreferences = {
  proxy: { http?: string; https?: string };
  defaultModel?: { provider: string; modelId: string; thinkingLevel?: string };
};

export type ConfigSnapshot = {
  app: AppPreferences;
  providers: Array<ProviderProfile & { hasKey: boolean }>;
};

/** 配置动作桥:与 window.pidesk 结构兼容子集 */
export type ConfigBridge = {
  configGet(): Promise<ConfigSnapshot>;
  configAppSave(app: AppPreferences): Promise<ConfigSnapshot>;
  configProviderUpsert(profile: ProviderProfile, apiKey?: string): Promise<ConfigSnapshot>;
  configProviderRemove(id: string): Promise<ConfigSnapshot>;
  configDefaultModelSet(defaultModel?: AppPreferences["defaultModel"]): Promise<ConfigSnapshot>;
  configSkillsList?(): Promise<SkillInfo[]>;
  configSkillsImport?(): Promise<{ cancelled: boolean; skills: SkillInfo[] }>;
  configSkillsSetEnabled?(id: string, enabled: boolean): Promise<SkillInfo[]>;
  configSkillsRemove?(id: string): Promise<SkillInfo[]>;
  configMcpList?(): Promise<McpServerConfig[]>;
  configMcpUpsert?(server: McpServerConfig): Promise<McpServerConfig[]>;
  configMcpRemove?(id: string): Promise<McpServerConfig[]>;
};

function resolveBridge(explicit?: ConfigBridge): ConfigBridge | undefined {
  if (explicit) return explicit;
  const candidate = (globalThis as { pidesk?: Partial<ConfigBridge> }).pidesk;
  if (
    candidate &&
    typeof candidate.configGet === "function" &&
    typeof candidate.configAppSave === "function" &&
    typeof candidate.configProviderUpsert === "function" &&
    typeof candidate.configProviderRemove === "function" &&
    typeof candidate.configDefaultModelSet === "function"
  ) {
    return candidate as ConfigBridge;
  }
  return undefined;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- 导航定义 ----------

const SECTIONS = [
  { key: "models", label: "模型与凭据" },
  { key: "proxy", label: "代理" },
  { key: "skills", label: "Skills" },
  { key: "mcp", label: "MCP" },
  { key: "extensions", label: "扩展" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/** 表单草稿:models 用「每行 id 或 id|name」的 textarea 文本表达 */
type ProviderDraft = {
  id: string;
  name: string;
  preset: ProviderPreset;
  baseUrl: string;
  modelsText: string;
  defaultModelId: string;
  saveKey: boolean;
  apiKey: string;
};

const EMPTY_DRAFT: ProviderDraft = {
  id: "",
  name: "",
  preset: "ollama",
  baseUrl: "http://localhost:11434/v1",
  modelsText: "",
  defaultModelId: "",
  saveKey: true,
  apiKey: "",
};

/** modelsText → ProviderModel[]:空行忽略;「id|name」拆 name */
function parseModels(text: string): ProviderModel[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const idx = line.indexOf("|");
      if (idx < 0) return { id: line };
      return { id: line.slice(0, idx).trim(), name: line.slice(idx + 1).trim() || undefined };
    });
}

function draftFromProfile(profile: ProviderProfile & { hasKey: boolean }): ProviderDraft {
  return {
    id: profile.id,
    name: profile.name,
    preset: profile.preset,
    baseUrl: profile.baseUrl,
    modelsText: profile.models.map((m) => (m.name ? `${m.id}|${m.name}` : m.id)).join("\n"),
    defaultModelId: profile.defaultModelId ?? "",
    saveKey: profile.saveKey,
    apiKey: "",
  };
}

/** MCP 表单草稿:args / env 用「每行一条」的 textarea 文本表达 */
type McpDraft = {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  argsText: string;
  envText: string;
  url: string;
  enabled: boolean;
};

const EMPTY_MCP_DRAFT: McpDraft = {
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  argsText: "",
  envText: "",
  url: "",
  enabled: true,
};

function mcpDraftFromServer(server: McpServerConfig): McpDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    argsText: (server.args ?? []).join("\n"),
    envText: Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    url: server.url ?? "",
    enabled: server.enabled,
  };
}

/** argsText → string[]:空行忽略 */
function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** envText → Record<string,string>:每行 KEY=VALUE,非法行忽略 */
function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

// ---------- 输入控件(统一样式,无 hover) ----------

const inputCls =
  "h-8 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-1)] px-2 text-[13px] text-[var(--text-0)] outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--text-1)]">{label}</span>
      {children}
    </label>
  );
}

const btnNeutral =
  "h-8 rounded-[8px] bg-[var(--text-0)] px-3 text-[14px] text-[var(--bg-1)]";
const btnGhost =
  "h-8 rounded-[8px] border border-[var(--hairline)] bg-[var(--bg-2)] px-3 text-[13px] text-[var(--text-0)]";

// ---------- 主组件 ----------

export type ConfigCenterProps = {
  /** 返回会话视图(左上角返回按钮) */
  onClose(): void;
  /** 桥注入(测试用);缺省读 window.pidesk 子集 */
  bridge?: ConfigBridge;
};

export function ConfigCenter({ onClose, bridge }: ConfigCenterProps) {
  const resolved = resolveBridge(bridge);
  const { toasts, push } = useToasts();
  const [section, setSection] = useState<SectionKey>("models");
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null);
  // 编辑中的 provider:id 为空表示新增;null 表示关闭表单
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  // 代理设置本地编辑态(从 snapshot.app 拷贝)
  const [proxyHttp, setProxyHttp] = useState("");
  const [proxyHttps, setProxyHttps] = useState("");

  const load = useCallback(async () => {
    if (!resolved) return;
    try {
      const snap = await resolved.configGet();
      setSnapshot(snap);
      setProxyHttp(snap.app.proxy.http ?? "");
      setProxyHttps(snap.app.proxy.https ?? "");
    } catch (err) {
      push(`加载配置失败:${errText(err)}`);
    }
  }, [resolved, push]);

  useEffect(() => {
    void load();
  }, [load]);

  const [skills, setSkills] = useState<SkillInfo[] | null>(null);

  const loadSkills = useCallback(async () => {
    if (typeof resolved?.configSkillsList !== "function") return;
    try {
      setSkills(await resolved.configSkillsList());
    } catch (err) {
      push(`加载 Skills 失败:${errText(err)}`);
    }
  }, [resolved, push]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const importSkills = async () => {
    if (typeof resolved?.configSkillsImport !== "function") return;
    try {
      const res = await resolved.configSkillsImport();
      if (res.cancelled) return;
      setSkills(res.skills);
      push("已导入");
    } catch (err) {
      push(`导入失败:${errText(err)}`);
    }
  };

  const toggleSkill = async (id: string, enabled: boolean) => {
    if (typeof resolved?.configSkillsSetEnabled !== "function") return;
    try {
      setSkills(await resolved.configSkillsSetEnabled(id, enabled));
    } catch (err) {
      push(`操作失败:${errText(err)}`);
    }
  };

  const removeSkill = async (id: string) => {
    if (typeof resolved?.configSkillsRemove !== "function") return;
    const confirmFn =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm
        : null;
    if (confirmFn && !confirmFn(`确认删除 Skill「${id}」?`)) return;
    try {
      setSkills(await resolved.configSkillsRemove(id));
    } catch (err) {
      push(`删除失败:${errText(err)}`);
    }
  };

  // ---------- MCP Server ----------
  const [mcpServers, setMcpServers] = useState<McpServerConfig[] | null>(null);
  // 编辑中的 MCP server:id 为空表示新增;null 表示关闭表单
  const [mcpDraft, setMcpDraft] = useState<McpDraft | null>(null);

  const loadMcp = useCallback(async () => {
    if (typeof resolved?.configMcpList !== "function") return;
    try {
      setMcpServers(await resolved.configMcpList());
    } catch (err) {
      push(`加载 MCP Server 失败:${errText(err)}`);
    }
  }, [resolved, push]);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  const saveMcp = () => {
    if (typeof resolved?.configMcpUpsert !== "function" || !mcpDraft) return;
    const id = mcpDraft.id.trim();
    if (!id) {
      push("id 不能为空");
      return;
    }
    if (!mcpDraft.name.trim()) {
      push("名称不能为空");
      return;
    }
    if (mcpDraft.transport === "stdio" && !mcpDraft.command.trim()) {
      push("stdio 传输需要填写 command");
      return;
    }
    if (mcpDraft.transport === "sse" && !mcpDraft.url.trim()) {
      push("sse 传输需要填写 url");
      return;
    }
    const server: McpServerConfig = {
      id,
      name: mcpDraft.name.trim(),
      transport: mcpDraft.transport,
      enabled: mcpDraft.enabled,
      ...(mcpDraft.transport === "stdio"
        ? {
            command: mcpDraft.command.trim(),
            args: parseLines(mcpDraft.argsText).length > 0 ? parseLines(mcpDraft.argsText) : undefined,
            env: parseEnv(mcpDraft.envText),
          }
        : { url: mcpDraft.url.trim() }),
    };
    void resolved
      .configMcpUpsert(server)
      .then((list) => {
        setMcpServers(list);
        setMcpDraft(null);
        push("已保存");
      })
      .catch((err: unknown) => push(`保存失败:${errText(err)}`));
  };

  const removeMcp = async (id: string) => {
    if (typeof resolved?.configMcpRemove !== "function") return;
    const confirmFn =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm
        : null;
    if (confirmFn && !confirmFn(`确认删除 MCP Server「${id}」?`)) return;
    try {
      setMcpServers(await resolved.configMcpRemove(id));
      push("已删除");
    } catch (err) {
      push(`删除失败:${errText(err)}`);
    }
  };

  const run = useCallback(
    async (action: () => Promise<ConfigSnapshot>, okText: string) => {
      if (!resolved) return;
      try {
        const snap = await action();
        setSnapshot(snap);
        setProxyHttp(snap.app.proxy.http ?? "");
        setProxyHttps(snap.app.proxy.https ?? "");
        push(okText);
      } catch (err) {
        push(`操作失败:${errText(err)}`);
      }
    },
    [resolved, push],
  );

  /** 保存 provider(新增或编辑) */
  const saveProvider = () => {
    if (!resolved || !draft) return;
    const profile: ProviderProfile = {
      id: draft.id.trim(),
      name: draft.name.trim() || draft.id.trim(),
      preset: draft.preset,
      baseUrl: draft.baseUrl.trim(),
      models: parseModels(draft.modelsText),
      defaultModelId: draft.defaultModelId.trim() || undefined,
      saveKey: draft.saveKey,
      enabled: true,
    };
    if (!profile.id) {
      push("id 不能为空");
      return;
    }
    const apiKey = draft.apiKey.trim();
    void run(
      () => resolved.configProviderUpsert(profile, apiKey || undefined),
      "已保存,重启会话后生效",
    ).then(() => setDraft(null));
  };

  /** 设为默认模型:provider + 其 defaultModelId(缺省取第一个模型) */
  const setDefault = (id: string) => {
    if (!resolved || !snapshot) return;
    const provider = snapshot.providers.find((p) => p.id === id);
    if (!provider) return;
    const modelId = provider.defaultModelId ?? provider.models[0]?.id;
    if (!modelId) {
      push("该连接没有可设默认的模型");
      return;
    }
    void run(
      () =>
        resolved.configDefaultModelSet({
          provider: id,
          modelId,
          ...(snapshot.app.defaultModel?.thinkingLevel
            ? { thinkingLevel: snapshot.app.defaultModel.thinkingLevel }
            : {}),
        }),
      "已设为默认模型",
    );
  };

  const saveProxy = () => {
    if (!resolved || !snapshot) return;
    void run(
      () =>
        resolved.configAppSave({
          proxy: {
            http: proxyHttp.trim() || undefined,
            https: proxyHttps.trim() || undefined,
          },
          defaultModel: snapshot.app.defaultModel,
        }),
      "已保存,重启会话后生效",
    );
  };

  const defaultModel = snapshot?.app.defaultModel;

  return (
    <div
      data-testid="config-center"
      className="flex h-full min-h-0 flex-col bg-[var(--bg-1)] text-[var(--text-0)]"
    >
      {/* 顶部 52px 拖拽顶栏:仅作 titlebar 拖拽区,不放交互元素;pr 预留右上窗口控制按钮区 */}
      <header className="titlebar-drag flex h-[52px] shrink-0 items-center bg-[var(--bg-1)] pl-4 pr-[148px]">
        <span className="truncate text-[14px] font-medium text-[var(--text-0)]">配置中心</span>
      </header>

      {/* 顶栏下方:左树形导航 + 右内容 */}
      <div className="flex min-h-0 flex-1">
      {/* 左侧树形导航 */}
      <aside className="flex w-[180px] shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--bg-0)] p-2">
        <div className="flex h-9 shrink-0 items-center justify-between px-2">
          <span className="text-[14px] font-semibold text-[var(--text-0)]">配置中心</span>
          <button
            type="button"
            aria-label="返回会话"
            onClick={onClose}
            className="text-[var(--text-1)]"
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
          </button>
        </div>
        {SECTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            data-testid={`config-section-${key}`}
            onClick={() => setSection(key)}
            className={
              "mt-0.5 flex h-[30px] w-full items-center rounded-[10px] px-2 text-left text-[14px] leading-5 " +
              (section === key
                ? "bg-[var(--surface-active)] text-[var(--text-0)]"
                : "bg-transparent text-[var(--text-1)]")
            }
          >
            {label}
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6 pt-4">
        {section === "models" && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">模型与凭据</h2>
              <button
                type="button"
                data-testid="config-provider-add"
                className={btnNeutral}
                onClick={() => setDraft({ ...EMPTY_DRAFT })}
              >
                新增连接
              </button>
            </div>

            {defaultModel && (
              <p className="text-[13px] text-[var(--text-1)]">
                默认模型:{defaultModel.provider} / {defaultModel.modelId}
              </p>
            )}

            {/* 编辑表单(内联,不弹窗) */}
            {draft && (
              <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="id">
                    <input
                      className={inputCls}
                      value={draft.id}
                      onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                    />
                  </Field>
                  <Field label="名称">
                    <input
                      className={inputCls}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      className={inputCls}
                      value={draft.preset}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          preset: e.target.value as ProviderPreset,
                          baseUrl:
                            e.target.value === "ollama"
                              ? "http://localhost:11434/v1"
                              : draft.baseUrl === "http://localhost:11434/v1"
                                ? ""
                                : draft.baseUrl,
                        })
                      }
                    >
                      <option value="ollama">Ollama(预置)</option>
                      <option value="custom-openai">自定义 OpenAI 兼容</option>
                    </select>
                  </Field>
                  <Field label="Base URL">
                    <input
                      className={inputCls}
                      value={draft.baseUrl}
                      onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="模型(每行一条:id 或 id|名称)">
                  <textarea
                    rows={4}
                    className={inputCls + " h-auto py-1.5"}
                    value={draft.modelsText}
                    onChange={(e) => setDraft({ ...draft, modelsText: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="默认模型 id">
                    <input
                      className={inputCls}
                      value={draft.defaultModelId}
                      onChange={(e) => setDraft({ ...draft, defaultModelId: e.target.value })}
                    />
                  </Field>
                  <Field label="API Key(留空不修改)">
                    <input
                      type="password"
                      className={inputCls}
                      value={draft.apiKey}
                      onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-[var(--text-1)]">
                  <input
                    type="checkbox"
                    checked={draft.saveKey}
                    onChange={(e) => setDraft({ ...draft, saveKey: e.target.checked })}
                  />
                  持久化 API Key(auth.json)
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="config-provider-save"
                    className={btnNeutral}
                    onClick={saveProvider}
                  >
                    保存
                  </button>
                  <button type="button" className={btnGhost} onClick={() => setDraft(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* provider 列表 */}
            {snapshot && snapshot.providers.length > 0 ? (
              snapshot.providers.map((provider) => (
                <div
                  key={provider.id}
                  data-testid={`config-provider-${provider.id}`}
                  className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{provider.name}</span>
                    <span className="text-[12px] text-[var(--text-1)]">{provider.id}</span>
                    <span className="rounded-[6px] border border-[var(--hairline)] px-1.5 text-[11px] text-[var(--text-1)]">
                      {provider.preset === "ollama" ? "Ollama" : "OpenAI 兼容"}
                    </span>
                    {provider.hasKey && (
                      <span className="text-[11px] text-[var(--text-1)]">已存 Key</span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--text-1)]">{provider.baseUrl}</p>
                  <p className="text-[12px] text-[var(--text-1)]">
                    模型:{provider.models.map((m) => m.id).join(", ") || "无"}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => setDraft(draftFromProfile(provider))}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        if (!resolved) return;
                        void run(
                          () => resolved.configProviderRemove(provider.id),
                          "已删除",
                        );
                      }}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => setDefault(provider.id)}
                    >
                      设为默认
                    </button>
                  </div>
                </div>
              ))
            ) : (
              !draft && (
                <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-6 text-center">
                  <p className="text-[13px] text-[var(--text-1)]">还没有模型连接</p>
                  <button
                    type="button"
                    className={btnNeutral + " mt-3"}
                    onClick={() => setDraft({ ...EMPTY_DRAFT })}
                  >
                    新增连接
                  </button>
                </div>
              )
            )}
          </section>
        )}

        {section === "proxy" && (
          <section className="flex max-w-[480px] flex-col gap-3">
            <h2 className="text-[16px] font-semibold">代理</h2>
            <Field label="HTTP 代理">
              <input
                className={inputCls}
                value={proxyHttp}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => setProxyHttp(e.target.value)}
              />
            </Field>
            <Field label="HTTPS 代理">
              <input
                className={inputCls}
                value={proxyHttps}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => setProxyHttps(e.target.value)}
              />
            </Field>
            <p className="text-[12px] text-[var(--text-1)]">
              当前:HTTP {snapshot?.app.proxy.http || "未设置"} / HTTPS{" "}
              {snapshot?.app.proxy.https || "未设置"}
            </p>
            <div>
              <button type="button" className={btnNeutral} onClick={saveProxy}>
                保存
              </button>
            </div>
          </section>
        )}

        {section === "skills" && (
          <section className="flex flex-col gap-3" data-testid="config-skills">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Skills</h2>
              <button
                type="button"
                data-testid="config-skills-import"
                className={btnNeutral}
                onClick={() => void importSkills()}
              >
                导入 Skills 目录
              </button>
            </div>

            {skills && skills.length > 0 ? (
              skills.map((skill) => (
                <div
                  key={skill.id}
                  data-testid={`config-skill-${skill.id}`}
                  className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{skill.name}</span>
                    <span className="text-[12px] text-[var(--text-1)]">{skill.id}</span>
                    <span
                      className={
                        skill.enabled
                          ? "text-[12px] text-[var(--text-0)]"
                          : "text-[12px] text-[var(--text-2)]"
                      }
                    >
                      {skill.enabled ? "启用" : "停用"}
                    </span>
                    {!skill.hasSkillFile && (
                      <span className="text-[12px] text-[var(--err)]">缺少 SKILL.md</span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="text-[12px] text-[var(--text-1)]">{skill.description}</p>
                  )}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => void toggleSkill(skill.id, !skill.enabled)}
                    >
                      {skill.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => void removeSkill(skill.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-6 text-center">
                <p className="text-[13px] text-[var(--text-1)]">还没有 Skills</p>
                <button
                  type="button"
                  data-testid="config-skills-import-empty"
                  className={btnNeutral + " mt-3"}
                  onClick={() => void importSkills()}
                >
                  导入 Skills 目录
                </button>
              </div>
            )}
          </section>
        )}

        {section === "mcp" && (
          <section className="flex flex-col gap-3" data-testid="config-mcp">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">MCP</h2>
              <button
                type="button"
                data-testid="config-mcp-add"
                className={btnNeutral}
                onClick={() => setMcpDraft({ ...EMPTY_MCP_DRAFT })}
              >
                新增 MCP Server
              </button>
            </div>

            {mcpDraft && (
              <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="id">
                    <input
                      className={inputCls}
                      value={mcpDraft.id}
                      onChange={(e) => setMcpDraft({ ...mcpDraft, id: e.target.value })}
                    />
                  </Field>
                  <Field label="名称">
                    <input
                      className={inputCls}
                      value={mcpDraft.name}
                      onChange={(e) => setMcpDraft({ ...mcpDraft, name: e.target.value })}
                    />
                  </Field>
                  <Field label="传输类型">
                    <select
                      className={inputCls}
                      value={mcpDraft.transport}
                      onChange={(e) =>
                        setMcpDraft({
                          ...mcpDraft,
                          transport: e.target.value as McpDraft["transport"],
                        })
                      }
                    >
                      <option value="stdio">stdio</option>
                      <option value="sse">sse</option>
                    </select>
                  </Field>
                  {mcpDraft.transport === "stdio" ? (
                    <Field label="command">
                      <input
                        className={inputCls}
                        value={mcpDraft.command}
                        onChange={(e) => setMcpDraft({ ...mcpDraft, command: e.target.value })}
                      />
                    </Field>
                  ) : (
                    <Field label="url">
                      <input
                        className={inputCls}
                        value={mcpDraft.url}
                        onChange={(e) => setMcpDraft({ ...mcpDraft, url: e.target.value })}
                      />
                    </Field>
                  )}
                </div>
                {mcpDraft.transport === "stdio" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="args(每行一个)">
                      <textarea
                        rows={3}
                        className={inputCls + " h-auto py-1.5"}
                        value={mcpDraft.argsText}
                        onChange={(e) => setMcpDraft({ ...mcpDraft, argsText: e.target.value })}
                      />
                    </Field>
                    <Field label="env(每行 KEY=VALUE)">
                      <textarea
                        rows={3}
                        className={inputCls + " h-auto py-1.5"}
                        value={mcpDraft.envText}
                        onChange={(e) => setMcpDraft({ ...mcpDraft, envText: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <label className="flex items-center gap-2 text-[13px] text-[var(--text-1)]">
                  <input
                    type="checkbox"
                    checked={mcpDraft.enabled}
                    onChange={(e) => setMcpDraft({ ...mcpDraft, enabled: e.target.checked })}
                  />
                  启用
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="config-mcp-save"
                    className={btnNeutral}
                    onClick={saveMcp}
                  >
                    保存
                  </button>
                  <button type="button" className={btnGhost} onClick={() => setMcpDraft(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}

            {mcpServers && mcpServers.length > 0 ? (
              mcpServers.map((server) => (
                <div
                  key={server.id}
                  data-testid={`config-mcp-${server.id}`}
                  className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium">{server.name}</span>
                    <span className="text-[12px] text-[var(--text-1)]">{server.id}</span>
                    <span className="text-[12px] text-[var(--text-1)]">{server.transport}</span>
                    <span
                      className={
                        server.enabled
                          ? "text-[12px] text-[var(--text-0)]"
                          : "text-[12px] text-[var(--text-2)]"
                      }
                    >
                      {server.enabled ? "启用" : "停用"}
                    </span>
                  </div>
                  {(server.transport === "stdio" ? server.command : server.url) && (
                    <p className="text-[12px] text-[var(--text-1)]">
                      {server.transport === "stdio"
                        ? [server.command, ...(server.args ?? [])].join(" ")
                        : server.url}
                    </p>
                  )}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => setMcpDraft(mcpDraftFromServer(server))}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => void removeMcp(server.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[12px] border border-[var(--hairline)] bg-[var(--bg-2)] p-6 text-center">
                <p className="text-[13px] text-[var(--text-1)]">还没有 MCP Server</p>
                <button
                  type="button"
                  data-testid="config-mcp-add-empty"
                  className={btnNeutral + " mt-3"}
                  onClick={() => setMcpDraft({ ...EMPTY_MCP_DRAFT })}
                >
                  新增 MCP Server
                </button>
              </div>
            )}
          </section>
        )}

        {section === "extensions" && (
          <section className="flex flex-col gap-1">
            <h2 className="text-[16px] font-semibold">扩展</h2>
            <p className="text-[13px] text-[var(--text-1)]">M2 后续卡片接入</p>
          </section>
        )}
      </div>
      </div>

      <ToastHost toasts={toasts} />
    </div>
  );
}
