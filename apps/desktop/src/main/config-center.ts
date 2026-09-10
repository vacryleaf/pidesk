// M2 config-center 数据层(纯存储/读写,不含 UI/IPC):
// - <dataDir>/app.json:{ version:1, proxy, defaultModel? }
// - <dataDir>/pi-agent/models.json:pi 兼容 { providers: { <id>: {name,api,baseUrl,models,apiKey?} } }
//   只写 enabled:true 的 providers,按 id 字典序稳定排序;ollama 内联 apiKey "ollama"(占位)。
// - <dataDir>/pi-agent/auth.json:pi 规范 { <id>: { type:"api_key", key } }
//   saveKey=true 且传入非空 key 才写/保留;否则删除该条目(保留其他 provider 条目)。
// - 所有文件原子写(tmp+rename),父目录 recursive mkdir;读 JSON 容错(缺失/损坏回退默认)。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  AppPreferences,
  ConfigSnapshot,
  ProviderModel,
  ProviderProfile,
} from "@pidesk/shared";

export type {
  AppPreferences,
  ConfigSnapshot,
  ProviderModel,
  ProviderPreset,
  ProviderProfile,
} from "@pidesk/shared";

/** models.json 单 provider 条目(pi 上游 provider 配置结构子集) */
interface ProviderEntry {
  name: string;
  api: "openai-completions";
  baseUrl: string;
  models: ProviderModel[];
  /** 占位鉴权(本地无鉴权 provider 如 Ollama 需要,否则模型不出现在可用列表) */
  apiKey?: string;
}

interface ModelsFile {
  providers: Record<string, ProviderEntry>;
}

/** auth.json 顶层结构:provider id → pi 规范凭据 */
interface AuthFile {
  [id: string]: { type?: unknown; key?: unknown } | undefined;
}

interface AppFile {
  version: number;
  proxy?: { http?: string; https?: string };
  defaultModel?: AppPreferences["defaultModel"];
}

/** 原子写:先写同目录临时文件再 rename,避免半写状态 */
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.${basename(path)}.tmp.${process.pid}`);
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, path);
}

/** 容错读 JSON:文件不存在/内容损坏 → undefined */
function readJsonSafe(path: string): unknown {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 隔离目录:<dataDir>/pi-agent */
function agentDir(dataDir: string): string {
  return join(dataDir, "pi-agent");
}

/** 读 auth.json(缺失/损坏 → 空对象) */
function readAuth(dataDir: string): AuthFile {
  const raw = readJsonSafe(join(agentDir(dataDir), "auth.json"));
  return isRecord(raw) ? (raw as AuthFile) : {};
}

/** auth 条目是否为规范的真实 key:{ type:"api_key", key:<string> } */
function hasRealKey(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return entry.type === "api_key" && typeof entry.key === "string" && entry.key.length > 0;
}

/** 读 models.json(缺失/损坏 → 空 providers) */
function readModels(dataDir: string): ModelsFile {
  const raw = readJsonSafe(join(agentDir(dataDir), "models.json"));
  if (isRecord(raw) && isRecord(raw.providers)) {
    return { providers: raw.providers as Record<string, ProviderEntry> };
  }
  return { providers: {} };
}

/** 读 app.json(缺失/损坏 → 默认 { version:1, proxy:{} }) */
function readApp(dataDir: string): AppFile {
  const raw = readJsonSafe(join(dataDir, "app.json"));
  if (isRecord(raw)) {
    const proxy = isRecord(raw.proxy) ? raw.proxy : {};
    return {
      version: 1,
      proxy: {
        http: asString(proxy.http),
        https: asString(proxy.https),
      },
      ...(isRecord(raw.defaultModel)
        ? { defaultModel: raw.defaultModel as AppPreferences["defaultModel"] }
        : {}),
    };
  }
  return { version: 1, proxy: {} };
}

/** 写 app.json(version:1) */
function writeApp(dataDir: string, app: AppPreferences): void {
  const file: AppFile = {
    version: 1,
    proxy: app.proxy ?? {},
    ...(app.defaultModel ? { defaultModel: app.defaultModel } : {}),
  };
  atomicWrite(join(dataDir, "app.json"), JSON.stringify(file, null, 2) + "\n");
}

/** 重写 models.json:仅 enabled 条目,按 id 字典序稳定排序 */
function persistModels(dataDir: string, models: ModelsFile): void {
  const sorted: ModelsFile = { providers: {} };
  for (const id of Object.keys(models.providers).sort()) {
    const entry = models.providers[id];
    if (entry) sorted.providers[id] = entry;
  }
  atomicWrite(
    join(agentDir(dataDir), "models.json"),
    JSON.stringify(sorted, null, 2) + "\n",
  );
}

/** upsert provider 后重写 models.json */
function writeModels(dataDir: string, upsert: ProviderProfile): void {
  const models = readModels(dataDir);
  if (upsert.enabled) {
    models.providers[upsert.id] = {
      name: upsert.name,
      api: "openai-completions",
      baseUrl: upsert.baseUrl,
      models: upsert.models.map((m) => ({ id: m.id, ...(m.name ? { name: m.name } : {}) })),
      ...(upsert.preset === "ollama" ? { apiKey: "ollama" } : {}),
    };
  } else {
    // enabled:false → 不出现在 models.json(条目随之移除)
    delete models.providers[upsert.id];
  }
  persistModels(dataDir, models);
}

/** 按 pi 规范重写 auth.json:应用单条 upsert 规则(saveKey+非空 key 才保留) */
function writeAuthEntry(dataDir: string, id: string, saveKey: boolean, apiKey?: string): void {
  const auth = readAuth(dataDir);
  if (saveKey && apiKey) {
    auth[id] = { type: "api_key", key: apiKey };
  } else {
    // saveKey=false 或 key 为空:删除已有条目,不留旧 key
    delete auth[id];
  }
  atomicWrite(join(agentDir(dataDir), "auth.json"), JSON.stringify(auth, null, 2) + "\n");
}

/** 读取完整配置快照(app 偏好 + enabled providers,含 hasKey 回显) */
export function loadConfig(dataDir: string): ConfigSnapshot {
  const appRaw = readApp(dataDir);
  const app: AppPreferences = {
    proxy: { http: appRaw.proxy?.http, https: appRaw.proxy?.https },
    ...(appRaw.defaultModel ? { defaultModel: appRaw.defaultModel } : {}),
  };
  const models = readModels(dataDir);
  const auth = readAuth(dataDir);
  const providers = Object.keys(models.providers)
    .sort()
    .map((id) => {
      const entry = models.providers[id]!;
      if (!entry) return undefined;
      const profile: ProviderProfile & { hasKey: boolean } = {
        id,
        name: asString(entry.name) ?? id,
        // 旧/外部文件无 preset 字段时按 ollama 占位 apiKey 启发回退,默认 custom-openai
        preset:
          entry.apiKey === "ollama" || id === "ollama" ? "ollama" : "custom-openai",
        baseUrl: asString(entry.baseUrl) ?? "",
        models: Array.isArray(entry.models)
          ? entry.models
              .filter((m): m is ProviderModel => isRecord(m) && typeof m.id === "string")
              .map((m) => ({ id: m.id, ...(asString(m.name) ? { name: m.name } : {}) }))
          : [],
        saveKey: hasRealKey(auth[id]),
        enabled: true, // models.json 只存 enabled 条目
        hasKey: hasRealKey(auth[id]),
      };
      return profile;
    })
    .filter((p): p is ProviderProfile & { hasKey: boolean } => p !== undefined);
  return { app, providers };
}

/** 保存应用偏好(app.json,原子写) */
export function saveAppPreferences(dataDir: string, app: AppPreferences): void {
  writeApp(dataDir, app);
}

/** 新增/更新 provider(models.json + auth.json,原子写) */
export function upsertProvider(dataDir: string, profile: ProviderProfile, apiKey?: string): void {
  writeModels(dataDir, profile);
  writeAuthEntry(dataDir, profile.id, profile.saveKey, apiKey);
}

/** 删除 provider(models.json 与 auth.json 同时移除该 id) */
export function removeProvider(dataDir: string, id: string): void {
  const models = readModels(dataDir);
  delete models.providers[id];
  persistModels(dataDir, models);
  const auth = readAuth(dataDir);
  delete auth[id];
  atomicWrite(join(agentDir(dataDir), "auth.json"), JSON.stringify(auth, null, 2) + "\n");
}

/** 设置默认模型(app.json defaultModel,原子写) */
export function setDefaultModel(dataDir: string, model: AppPreferences["defaultModel"]): void {
  const appRaw = readApp(dataDir);
  const app: AppPreferences = {
    proxy: { http: appRaw.proxy?.http, https: appRaw.proxy?.https },
  };
  if (model) app.defaultModel = model;
  writeApp(dataDir, app);
}
