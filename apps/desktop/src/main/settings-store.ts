// 单连接模型配置落盘(T11a,m1-design §4/§6):
// - models.json:<dataDir>/pi-agent/models.json,结构
//     { "providers": { "<preset>": { "name","api":"openai-completions","baseUrl","models":[{"id","name"}] } } }
//   preset 仅 "ollama"(baseUrl http://localhost:11434/v1)或 "custom-openai"(用户 baseUrl);M1 单连接,整文件只存当前 preset。
// - auth.json:仅当 saveKey=true 时写 <dataDir>/pi-agent/auth.json,结构 { "<preset>": { "apiKey": "sk-…" } };
//   saveKey=false 不写 auth(仅本会话环境变量语义,M1 先不注入 env,TODO:M2 接 env 注入)。
// - 原子写(tmp+rename,模式同 pi-host env.ts bootstrapDataDir);读取容错(文件不存在/损坏 → 返回默认配置)。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ProviderConfig } from "@pidesk/shared";

/** 默认配置(M1 定版:Ollama 预置;文件缺失/损坏时回退) */
const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  preset: "ollama",
  baseUrl: "http://localhost:11434/v1",
  modelId: "",
  saveKey: false,
};

/** models.json 单 provider 条目(pi 上游 provider 配置结构子集) */
interface ProviderEntry {
  /** provider 显示名 */
  name: string;
  /** API 协议,M1 两 preset 均走 openai 兼容补全 */
  api: "openai-completions";
  baseUrl: string;
  /** 模型列表(单连接仅当前选中模型) */
  models: Array<{ id: string; name: string }>;
}

/** models.json 顶层结构 */
interface ModelsFile {
  providers: Record<string, ProviderEntry>;
}

/** auth.json 顶层结构:preset → 凭据 */
interface AuthFile {
  [preset: string]: { apiKey: string } | undefined;
}

/** preset → 显示名(models.json name 字段) */
const PRESET_NAMES: Record<ProviderConfig["preset"], string> = {
  ollama: "Ollama",
  "custom-openai": "Custom OpenAI",
};

/** 原子写:先写同目录临时文件再 rename,避免半写状态(模式同 pi-host env.ts) */
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.${basename(path)}.tmp.${process.pid}`);
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, path);
}

/** 容错读 JSON:文件不存在/内容损坏 → undefined(调用方按缺失处理) */
function readJsonSafe(path: string): unknown {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** 防御式取字符串字段 */
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** 隔离目录:<dataDir>/pi-agent */
function agentDir(dataDir: string): string {
  return join(dataDir, "pi-agent");
}

/**
 * 读取模型连接配置:models.json + auth.json 还原 ProviderConfig。
 * 容错语义:任一文件缺失/损坏 → 对应部分回退默认(整体无效则返回 DEFAULT_PROVIDER_CONFIG)。
 * - preset 取舍:M1 单连接,文件理论上只存一个 preset;防御性按 ollama > custom-openai 优先取。
 * - saveKey:由 auth.json 是否有该 preset 的 key 还原(key 已保存即视为勾选)。
 * 注意:返回未脱敏真实 apiKey,脱敏由调用方(pi-host-manager)负责。
 */
export function loadProviderConfig(dataDir: string): ProviderConfig {
  const modelsRaw = readJsonSafe(join(agentDir(dataDir), "models.json"));
  if (!modelsRaw || typeof modelsRaw !== "object") return { ...DEFAULT_PROVIDER_CONFIG };
  const providers = (modelsRaw as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object") return { ...DEFAULT_PROVIDER_CONFIG };

  // 单连接 preset 取舍:ollama 优先,其次 custom-openai
  const order: Array<ProviderConfig["preset"]> = ["ollama", "custom-openai"];
  const rec = providers as Record<string, unknown>;
  const preset = order.find((p) => rec[p] && typeof rec[p] === "object");
  if (!preset) return { ...DEFAULT_PROVIDER_CONFIG };

  // 防御式还原字段(models 数组取首个 id 作为当前 modelId)
  const entry = rec[preset] as ProviderEntry;
  const baseUrl = asString(entry.baseUrl) ?? DEFAULT_PROVIDER_CONFIG.baseUrl;
  const firstModel = Array.isArray(entry.models) ? entry.models[0] : undefined;
  const modelId =
    firstModel && typeof firstModel === "object" ? (asString(firstModel.id) ?? "") : "";

  // auth.json 还原已保存凭据(缺失/损坏 → 视为未保存)
  const authRaw = readJsonSafe(join(agentDir(dataDir), "auth.json"));
  const apiKey = authRaw && typeof authRaw === "object"
    ? (authRaw as AuthFile)[preset]?.apiKey
    : undefined;

  return {
    preset,
    baseUrl,
    modelId,
    ...(apiKey ? { apiKey } : {}),
    saveKey: Boolean(apiKey),
  };
}

/**
 * 保存模型连接配置(原子写):
 * - models.json:整文件只写当前 preset(M1 单连接;切换 preset 时旧条目随之清除)。
 * - auth.json:saveKey=true 且 apiKey 非空 → 合并写入该 preset 的 key(保留其他 preset 既有 key);
 *   saveKey=false 不写 auth 也不删已有 key(仅本会话环境变量语义,M1 先不注入 env,TODO:M2 接 env 注入)。
 */
export function saveProviderConfig(dataDir: string, config: ProviderConfig): void {
  // models.json:表单 → pi provider 配置结构
  const models: ModelsFile = {
    providers: {
      [config.preset]: {
        name: PRESET_NAMES[config.preset],
        api: "openai-completions",
        baseUrl: config.baseUrl,
        models: config.modelId ? [{ id: config.modelId, name: config.modelId }] : [],
      },
    },
  };
  atomicWrite(join(agentDir(dataDir), "models.json"), JSON.stringify(models, null, 2) + "\n");

  // auth.json:仅在用户勾选保存时落盘凭据
  if (config.saveKey && config.apiKey) {
    const authRaw = readJsonSafe(join(agentDir(dataDir), "auth.json"));
    const auth: Record<string, { apiKey: string }> =
      authRaw && typeof authRaw === "object" ? (authRaw as Record<string, { apiKey: string }>) : {};
    auth[config.preset] = { apiKey: config.apiKey };
    atomicWrite(join(agentDir(dataDir), "auth.json"), JSON.stringify(auth, null, 2) + "\n");
  }
}
