// M2 MCP 存储层测试:临时目录,覆盖 list/校验/remove/syncGenerated/原子写。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listMcpServers,
  removeMcpServer,
  syncMcpGenerated,
  upsertMcpServer,
} from "./mcp-store";
import type { McpServerConfig } from "@pidesk/shared";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pidesk-mcp-store-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const stdioServer: McpServerConfig = {
  id: "b-server",
  name: "Stdio Server",
  transport: "stdio",
  command: "npx",
  args: ["-y", "some-mcp"],
  env: { FOO: "bar" },
  enabled: true,
};

const sseServer: McpServerConfig = {
  id: "a-server",
  name: "SSE Server",
  transport: "sse",
  url: "http://127.0.0.1:3000/mcp",
  enabled: false,
};

describe("mcp-store", () => {
  it("listMcpServers:缺失 mcp.json → 空 list", () => {
    expect(listMcpServers(dataDir)).toEqual([]);
  });

  it("listMcpServers:损坏 mcp.json → 回退空 list", () => {
    writeFileSync(join(dataDir, "mcp.json"), "{not json", "utf8");
    expect(listMcpServers(dataDir)).toEqual([]);
  });

  it("upsertMcpServer:stdio + sse 成功,list 按 id 排序", () => {
    expect(upsertMcpServer(dataDir, stdioServer)).toHaveLength(1);
    const list = upsertMcpServer(dataDir, sseServer);
    expect(list.map((s) => s.id)).toEqual(["a-server", "b-server"]);
    expect(list[0]).toMatchObject({ transport: "sse", url: sseServer.url, enabled: false });
  });

  it("upsertMcpServer:同 id 覆盖", () => {
    upsertMcpServer(dataDir, stdioServer);
    const list = upsertMcpServer(dataDir, { ...stdioServer, name: "Renamed" });
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Renamed");
  });

  it("upsertMcpServer:校验失败(id/name/command/url/transport)", () => {
    expect(() => upsertMcpServer(dataDir, { ...stdioServer, id: "" })).toThrow(/id/);
    expect(() => upsertMcpServer(dataDir, { ...stdioServer, name: "" })).toThrow(/name/);
    expect(() =>
      upsertMcpServer(dataDir, { ...stdioServer, command: undefined }),
    ).toThrow(/command/);
    expect(() =>
      upsertMcpServer(dataDir, { ...sseServer, url: undefined }),
    ).toThrow(/url/);
    expect(() =>
      upsertMcpServer(dataDir, { ...stdioServer, transport: "websocket" as never }),
    ).toThrow(/transport/);
    // 失败后不落盘
    expect(listMcpServers(dataDir)).toEqual([]);
  });

  it("removeMcpServer:删除后返回最新 list", () => {
    upsertMcpServer(dataDir, stdioServer);
    upsertMcpServer(dataDir, sseServer);
    const list = removeMcpServer(dataDir, "b-server");
    expect(list.map((s) => s.id)).toEqual(["a-server"]);
  });

  it("syncMcpGenerated:只含 enabled、按 id 排序、结构正确", () => {
    upsertMcpServer(dataDir, stdioServer);
    upsertMcpServer(dataDir, sseServer);
    const generated = JSON.parse(
      readFileSync(join(dataDir, "pi-agent", "mcp-generated.json"), "utf8"),
    ) as { version: number; servers: Array<Record<string, unknown>> };
    expect(generated.version).toBe(1);
    expect(generated.servers.map((s) => s.id)).toEqual(["b-server"]); // 仅 enabled
    expect(generated.servers[0]).toEqual({
      id: "b-server",
      name: "Stdio Server",
      transport: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: { FOO: "bar" },
    });
  });

  it("syncMcpGenerated:父目录不存在时 recursive 创建", () => {
    syncMcpGenerated(dataDir);
    expect(existsSync(join(dataDir, "pi-agent", "mcp-generated.json"))).toBe(true);
  });

  it("原子写:写入后 mcp.json 与 generated 均为合法 JSON", () => {
    upsertMcpServer(dataDir, stdioServer);
    removeMcpServer(dataDir, stdioServer.id);
    expect(() => JSON.parse(readFileSync(join(dataDir, "mcp.json"), "utf8"))).not.toThrow();
    expect(() =>
      JSON.parse(readFileSync(join(dataDir, "pi-agent", "mcp-generated.json"), "utf8")),
    ).not.toThrow();
  });
});
