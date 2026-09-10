// M2 MCP 配置存储(纯存储,不含 UI/IPC/MCP 网络):
// - 应用侧配置:<dataDir>/mcp.json,结构 { version:1, servers: McpServerConfig[] }
// - pi 侧生成:<dataDir>/pi-agent/mcp-generated.json,仅含 enabled:true,按 id 排序
// - 读取损坏/缺失回退空配置;写入均为原子写(临时文件 + rename)

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpServerConfig, McpTransport } from "@pidesk/shared";

const MCP_FILE = "mcp.json";
const GENERATED_FILE = "mcp-generated.json";

type McpConfigFile = { version: 1; servers: McpServerConfig[] };
type McpGeneratedServer = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};
type McpGeneratedFile = { version: 1; servers: McpGeneratedServer[] };

function emptyConfig(): McpConfigFile {
  return { version: 1, servers: [] };
}

function mcpPath(dataDir: string): string {
  return join(dataDir, MCP_FILE);
}

function generatedPath(dataDir: string): string {
  return join(dataDir, "pi-agent", GENERATED_FILE);
}

/** 原子写:先写同目录临时文件,再 rename 覆盖 */
function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

/** 读应用配置:缺失/损坏/形状非法 → 回退空配置 */
function readConfig(dataDir: string): McpConfigFile {
  try {
    const raw = readFileSync(mcpPath(dataDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as McpConfigFile).servers)
    ) {
      return emptyConfig();
    }
    return { version: 1, servers: (parsed as McpConfigFile).servers };
  } catch {
    return emptyConfig();
  }
}

function writeConfig(dataDir: string, config: McpConfigFile): void {
  atomicWrite(mcpPath(dataDir), JSON.stringify(config, null, 2));
}

/** 校验并抛错:id/name 非空、transport 合法、stdio 必有 command、sse 必有 url */
function validateServer(server: McpServerConfig): void {
  if (!server || typeof server.id !== "string" || server.id.trim() === "") {
    throw new Error("mcp-store: id 不能为空");
  }
  if (typeof server.name !== "string" || server.name.trim() === "") {
    throw new Error(`mcp-store: server "${server.id}" name 不能为空`);
  }
  if (server.transport !== "stdio" && server.transport !== "sse") {
    throw new Error(`mcp-store: server "${server.id}" transport 非法: "${String(server.transport)}"`);
  }
  if (server.transport === "stdio" && (!server.command || server.command.trim() === "")) {
    throw new Error(`mcp-store: stdio server "${server.id}" 缺少 command`);
  }
  if (server.transport === "sse" && (!server.url || server.url.trim() === "")) {
    throw new Error(`mcp-store: sse server "${server.id}" 缺少 url`);
  }
}

/** 把 enabled 的 server 裁剪成 pi 侧生成结构(去掉 enabled 字段) */
function toGeneratedServer(server: McpServerConfig): McpGeneratedServer {
  const out: McpGeneratedServer = { id: server.id, name: server.name, transport: server.transport };
  if (server.command !== undefined) out.command = server.command;
  if (server.args !== undefined) out.args = server.args;
  if (server.env !== undefined) out.env = server.env;
  if (server.url !== undefined) out.url = server.url;
  return out;
}

/** 读应用配置列表(按 id 字典序) */
export function listMcpServers(dataDir: string): McpServerConfig[] {
  return readConfig(dataDir).servers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 新增或覆盖一个 server,写盘并同步生成 pi 侧文件,返回最新 list */
export function upsertMcpServer(dataDir: string, server: McpServerConfig): McpServerConfig[] {
  validateServer(server);
  const config = readConfig(dataDir);
  const idx = config.servers.findIndex((s) => s.id === server.id);
  if (idx >= 0) {
    config.servers[idx] = server;
  } else {
    config.servers.push(server);
  }
  writeConfig(dataDir, config);
  syncMcpGenerated(dataDir);
  return listMcpServers(dataDir);
}

/** 删除一个 server,写盘并同步生成 pi 侧文件,返回最新 list */
export function removeMcpServer(dataDir: string, id: string): McpServerConfig[] {
  const config = readConfig(dataDir);
  config.servers = config.servers.filter((s) => s.id !== id);
  writeConfig(dataDir, config);
  syncMcpGenerated(dataDir);
  return listMcpServers(dataDir);
}

/** 把应用配置同步为 pi 侧 mcp-generated.json:仅 enabled:true,按 id 排序,原子写 */
export function syncMcpGenerated(dataDir: string): void {
  const servers = readConfig(dataDir)
    .servers.filter((s) => s.enabled)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(toGeneratedServer);
  const out: McpGeneratedFile = { version: 1, servers };
  atomicWrite(generatedPath(dataDir), JSON.stringify(out, null, 2));
}
