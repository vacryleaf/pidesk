// M2 flow-bridge:启动时把 pi 侧 flow-bridge.ts 扩展写入隔离目录(幂等,原子写)。
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

export function bootstrapExtensions(dataDir: string): void {
  const extDir = join(dataDir, "pi-agent", "extensions");
  mkdirSync(extDir, { recursive: true });
  const target = join(extDir, "flow-bridge.ts");
  if (existsSync(target)) return;
  // 原子写:先写同目录 tmp 文件再 rename,避免半截文件
  const tmp = join(extDir, "flow-bridge.ts.tmp");
  writeFileSync(tmp, FLOW_BRIDGE_SOURCE, "utf8");
  renameSync(tmp, target);
}
