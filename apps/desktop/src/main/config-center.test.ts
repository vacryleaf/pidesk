// M2 config-center 数据层测试:临时目录 + vitest,覆盖 upsert/saveKey/ollama/remove/偏好持久化/原子写。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  removeProvider,
  saveAppPreferences,
  setDefaultModel,
  upsertProvider,
  type ProviderProfile,
} from "./config-center";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pidesk-config-center-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const custom: ProviderProfile = {
  id: "my-openai",
  name: "My OpenAI",
  preset: "custom-openai",
  baseUrl: "https://api.example.com/v1",
  models: [{ id: "gpt-x", name: "GPT X" }],
  defaultModelId: "gpt-x",
  saveKey: true,
  enabled: true,
};

describe("config-center", () => {
  it("upsert custom provider(saveKey=true)→ load 字段/hasKey/models.json/auth.json 正确", () => {
    upsertProvider(dataDir, custom, "sk-test-123");

    const snap = loadConfig(dataDir);
    expect(snap.providers).toHaveLength(1);
    const p = snap.providers[0]!;
    expect(p.id).toBe("my-openai");
    expect(p.name).toBe("My OpenAI");
    expect(p.preset).toBe("custom-openai");
    expect(p.baseUrl).toBe("https://api.example.com/v1");
    expect(p.models).toEqual([{ id: "gpt-x", name: "GPT X" }]);
    expect(p.enabled).toBe(true);
    expect(p.hasKey).toBe(true);

    const models = JSON.parse(readFileSync(join(dataDir, "pi-agent", "models.json"), "utf8"));
    expect(models.providers["my-openai"]).toEqual({
      name: "My OpenAI",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      models: [{ id: "gpt-x", name: "GPT X" }],
    });
    // 不应有内联 apiKey(仅 ollama 占位)
    expect(models.providers["my-openai"].apiKey).toBeUndefined();

    const auth = JSON.parse(readFileSync(join(dataDir, "pi-agent", "auth.json"), "utf8"));
    expect(auth["my-openai"]).toEqual({ type: "api_key", key: "sk-test-123" });
  });

  it("saveKey=false → auth 无该 key、hasKey=false,且删除已有 key", () => {
    upsertProvider(dataDir, custom, "sk-old");
    expect(loadConfig(dataDir).providers[0]!.hasKey).toBe(true);

    upsertProvider(dataDir, { ...custom, saveKey: false }); // 不传 key
    const snap = loadConfig(dataDir);
    expect(snap.providers[0]!.hasKey).toBe(false);
    const auth = JSON.parse(readFileSync(join(dataDir, "pi-agent", "auth.json"), "utf8"));
    expect(auth["my-openai"]).toBeUndefined();

    // 空 key 同样删除
    upsertProvider(dataDir, { ...custom, saveKey: true }, "");
    expect(loadConfig(dataDir).providers[0]!.hasKey).toBe(false);
  });

  it("ollama 条目 models.json 内联 apiKey 'ollama'", () => {
    upsertProvider(dataDir, {
      id: "ollama",
      name: "Ollama",
      preset: "ollama",
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "llama3" }],
      saveKey: false,
      enabled: true,
    });
    const models = JSON.parse(readFileSync(join(dataDir, "pi-agent", "models.json"), "utf8"));
    expect(models.providers["ollama"]!.apiKey).toBe("ollama");
    // 内联占位不算 hasKey(仅 auth.json 真实 key)
    expect(loadConfig(dataDir).providers[0]!.hasKey).toBe(false);
  });

  it("removeProvider 同时清 models.json 与 auth.json", () => {
    upsertProvider(dataDir, custom, "sk-1");
    upsertProvider(
      dataDir,
      { ...custom, id: "other", name: "Other", saveKey: true },
      "sk-2",
    );
    removeProvider(dataDir, "my-openai");

    const models = JSON.parse(readFileSync(join(dataDir, "pi-agent", "models.json"), "utf8"));
    expect(models.providers["my-openai"]).toBeUndefined();
    expect(models.providers["other"]).toBeDefined();
    const auth = JSON.parse(readFileSync(join(dataDir, "pi-agent", "auth.json"), "utf8"));
    expect(auth["my-openai"]).toBeUndefined();
    // 保留其他 provider 条目
    expect(auth["other"]).toEqual({ type: "api_key", key: "sk-2" });
  });

  it("saveAppPreferences/setDefaultModel 持久化;损坏 app.json 回退默认", () => {
    saveAppPreferences(dataDir, { proxy: { http: "http://127.0.0.1:7890" } });
    setDefaultModel(dataDir, { provider: "my-openai", modelId: "gpt-x", thinkingLevel: "high" });

    let snap = loadConfig(dataDir);
    expect(snap.app.proxy.http).toBe("http://127.0.0.1:7890");
    expect(snap.app.defaultModel).toEqual({
      provider: "my-openai",
      modelId: "gpt-x",
      thinkingLevel: "high",
    });

    // 损坏 app.json → 回退默认 {proxy:{}}
    writeFileSync(join(dataDir, "app.json"), "{broken", "utf8");
    snap = loadConfig(dataDir);
    expect(snap.app).toEqual({ proxy: {} });
    // 回退后保存仍可恢复
    saveAppPreferences(dataDir, { proxy: { https: "http://p:1" } });
    expect(loadConfig(dataDir).app.proxy.https).toBe("http://p:1");
  });

  it("原子写后所有 JSON 可解析;providers 按 id 稳定排序;enabled=false 不落 models.json", () => {
    upsertProvider(dataDir, custom, "sk-a");
    upsertProvider(dataDir, { ...custom, id: "aaa", name: "AAA", saveKey: true }, "sk-b");
    upsertProvider(dataDir, { ...custom, id: "zzz", name: "ZZZ", enabled: false }, "sk-c");
    saveAppPreferences(dataDir, { proxy: {} });

    for (const f of ["app.json", "models.json", "auth.json"]) {
      const p = join(dataDir, f === "app.json" ? f : join("pi-agent", f));
      expect(() => JSON.parse(readFileSync(p, "utf8"))).not.toThrow();
    }
    const snap = loadConfig(dataDir);
    expect(snap.providers.map((p) => p.id)).toEqual(["aaa", "my-openai"]);
  });
});
