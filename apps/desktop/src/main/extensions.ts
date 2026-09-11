// M2 flow-bridge / mcp-bridge:启动时把 pi 侧扩展写入隔离目录(幂等,原子写)。
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FLOW_BRIDGE_SOURCE = `// pidesk flow-bridge:注册 flow_emit 工具,把结构化 JSON 结果落会话文件。
type FlowEmitParams = { json: string };

export default function activate(pi: {
  registerTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: FlowEmitParams) => Promise<unknown>;
  }): void;
  appendEntry(customType: string, data?: unknown): void;
}): void {
  pi.registerTool({
    name: "flow_emit",
    label: "Flow Emit",
    description: "提交本次 pi 节点的结构化 JSON 结果,供 pidesk flow-engine 读取。",
    parameters: {
      type: "object",
      properties: {
        json: { type: "string", description: "要提交的 JSON 字符串" },
      },
      required: ["json"],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, params: FlowEmitParams) {
      pi.appendEntry("flow-emit", { json: params.json, at: new Date().toISOString() });
      return { content: [{ type: "text", text: "flow result recorded" }] };
    },
  });
}
`;

export const MCP_BRIDGE_SOURCE = `// pidesk mcp-bridge:通过 stdio JSON-RPC 连接 MCP server,注册 mcp__<server>__<tool> 工具。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export default function activate(pi: {
  registerTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }): void;
  appendEntry(customType: string, data?: unknown): void;
}): void {
  let raw: string;
  try {
    raw = readFileSync(
      join(process.env.PI_CODING_AGENT_DIR ?? "", "mcp-generated.json"),
      "utf8",
    );
  } catch (e) {
    pi.appendEntry("mcp-error", {
      server: "*",
      message: "read mcp-generated.json failed: " + String(e),
    });
    return;
  }

  let config: { servers?: unknown };
  try {
    config = JSON.parse(raw);
  } catch (e) {
    pi.appendEntry("mcp-error", {
      server: "*",
      message: "parse mcp-generated.json failed: " + String(e),
    });
    return;
  }

  const servers = Array.isArray(config.servers) ? config.servers : [];
  for (const server of servers) {
    try {
      startServer(pi, server);
    } catch (e) {
      pi.appendEntry("mcp-error", { server: "?", message: String(e) });
    }
  }
}

function startServer(pi: {
  registerTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }): void;
  appendEntry(customType: string, data?: unknown): void;
}, server: {
  id: string;
  enabled?: boolean;
  transport?: string;
  command?: string;
  args?: unknown;
  env?: Record<string, string>;
}): void {
  if (server.enabled === false) {
    pi.appendEntry("mcp-error", { server: String(server.id), message: "server disabled" });
    return;
  }
  if (server.transport !== "stdio") {
    pi.appendEntry("mcp-error", {
      server: String(server.id),
      message: "unsupported transport: " + String(server.transport),
    });
    return;
  }
  if (typeof server.command !== "string") {
    pi.appendEntry("mcp-error", { server: String(server.id), message: "invalid command" });
    return;
  }

  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const child = spawn(server.command, args, {
    env: { ...process.env, ...(server.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 0;
  const pending = new Map();
  let buffer = "";

  function failAll(message) {
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
  }

  child.on("error", (e) => failAll("spawn error: " + String(e)));
  child.on("exit", (code) => failAll("mcp server exited with code " + String(code)));
  process.on("exit", () => {
    try {
      child.kill();
    } catch {}
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let idx = buffer.indexOf("\\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          if (msg && typeof msg.id === "number" && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) {
              p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
            } else {
              p.resolve(msg.result);
            }
          }
        } catch {}
      }
      idx = buffer.indexOf("\\n");
    }
  });

  function send(method, params) {
    nextId += 1;
    const id = nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\\n");
  }

  async function run() {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pidesk", version: "0.1.0" },
    });
    notify("notifications/initialized");
    const res = await send("tools/list");
    const tools = Array.isArray(res?.tools) ? res.tools : [];
    for (const tool of tools) {
      pi.registerTool({
        name: \`mcp__\${server.id}__\${tool.name}\`,
        label: tool.name,
        description: tool.description ?? "",
        parameters: tool.inputSchema || { type: "object", properties: {} },
        async execute(_id, params) {
          const r = await send("tools/call", { name: tool.name, arguments: params || {} });
          return {
            content: Array.isArray(r?.content)
              ? r.content
              : [{ type: "text", text: JSON.stringify(r) }],
            details: r,
          };
        },
      });
    }
    pi.appendEntry("mcp-connected", { server: server.id, tools: tools.map((t) => t.name) });
  }

  run().catch((e) => {
    pi.appendEntry("mcp-error", { server: server.id, message: String(e) });
  });
}
`;

function writeIfMissing(dir: string, fileName: string, source: string): void {
  const target = join(dir, fileName);
  if (existsSync(target)) return;
  // 原子写:先写同目录 tmp 文件再 rename,避免半截文件
  const tmp = join(dir, fileName + ".tmp");
  writeFileSync(tmp, source, "utf8");
  renameSync(tmp, target);
}

export function bootstrapExtensions(dataDir: string): void {
  const extDir = join(dataDir, "pi-agent", "extensions");
  mkdirSync(extDir, { recursive: true });
  writeIfMissing(extDir, "flow-bridge.ts", FLOW_BRIDGE_SOURCE);
  writeIfMissing(extDir, "mcp-bridge.ts", MCP_BRIDGE_SOURCE);
}
