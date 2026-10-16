import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type McpTransport,
  type Tool as McpTool,
} from "@earendil-works/pi-mcp";
import { Type } from "@earendil-works/pi-ai";
import { autoMedia, autoTable, humanize, type McpServerInfo, type UiBlock } from "@klymbak/protocol";
import type { Logger, McpServerConfig, McpToolFilter, ToolDefinition } from "./types.ts";

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const CONNECT_TIMEOUT_MS = 20_000;

interface Connection {
  name: string;
  config: McpServerConfig;
  runtime: boolean;
  status: McpServerInfo["status"];
  error?: string;
  client?: McpClient;
  tools: ToolDefinition<any>[];
}

/**
 * Connects to MCP servers and exposes their tools as harness tools named
 * `<prefix>_<tool>`. MCP tool annotations are honoured: readOnlyHint marks a tool
 * read-only and destructiveHint makes it ask for approval unless configured otherwise.
 */
export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private readonly logger: Logger;
  private readonly onChange: (server: McpServerInfo) => void;

  constructor(logger: Logger, onChange: (server: McpServerInfo) => void) {
    this.logger = logger;
    this.onChange = onChange;
  }

  async start(servers: Record<string, McpServerConfig>) {
    await Promise.all(Object.entries(servers).map(([name, config]) => this.connect(name, config, false)));
  }

  async connect(name: string, config: McpServerConfig, runtime: boolean): Promise<McpServerInfo> {
    if (!SERVER_NAME.test(name)) throw new Error(`Invalid MCP server name "${name}". Use letters, digits, - and _.`);
    if (this.connections.has(name)) await this.remove(name);

    const connection: Connection = {
      name,
      config,
      runtime,
      status: config.enabled === false ? "disabled" : "connecting",
      tools: [],
    };
    this.connections.set(name, connection);
    this.changed(connection);
    if (connection.status === "disabled") return this.describe(connection);

    try {
      const client = new McpClient({ name: "klymbak", version: "0.1.0", requestTimeoutMs: config.timeoutMs ?? 60_000 });
      await withTimeout(client.connect(this.transport(name, config)), CONNECT_TIMEOUT_MS, `Timed out connecting to ${name}`);
      connection.client = client;
      client.onClose(() => {
        if (this.connections.get(name) !== connection) return;
        connection.status = "error";
        connection.error = "Connection closed";
        connection.tools = [];
        connection.client = undefined;
        this.changed(connection);
      });
      client.onNotification("notifications/tools/list_changed", () => {
        this.loadTools(connection).catch((error) => this.logger.warn(`Reloading tools from ${name} failed`, String(error)));
      });
      await this.loadTools(connection);
      connection.status = "connected";
      connection.error = undefined;
      this.logger.info(`MCP server "${name}" connected with ${connection.tools.length} tools`);
    } catch (error) {
      connection.status = "error";
      connection.error = error instanceof Error ? error.message : String(error);
      this.logger.warn(`MCP server "${name}" failed to connect`, connection.error);
    }
    this.changed(connection);
    return this.describe(connection);
  }

  async remove(name: string): Promise<boolean> {
    const connection = this.connections.get(name);
    if (!connection) return false;
    this.connections.delete(name);
    await connection.client?.close().catch(() => undefined);
    return true;
  }

  async close() {
    await Promise.all([...this.connections.keys()].map((name) => this.remove(name)));
  }

  has(name: string) {
    return this.connections.has(name);
  }

  isRuntime(name: string) {
    return this.connections.get(name)?.runtime === true;
  }

  tools(): ToolDefinition<any>[] {
    return [...this.connections.values()].filter((c) => c.status === "connected").flatMap((c) => c.tools);
  }

  info(): McpServerInfo[] {
    return [...this.connections.values()].map((c) => this.describe(c));
  }

  private transport(name: string, config: McpServerConfig): McpTransport {
    if ("command" in config) {
      return new StdioTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
        stderr: "pipe",
        onStderr: (chunk) => this.logger.info(`[mcp:${name}] ${chunk.trimEnd()}`),
      });
    }
    return new StreamableHttpTransport({ url: config.url, headers: config.headers });
  }

  private async loadTools(connection: Connection) {
    if (!connection.client) return;
    const { include, exclude } = connection.config;
    const matches = (filter: string[] | ((name: string) => boolean), name: string) =>
      typeof filter === "function" ? filter(name) : filter.includes(name);
    const tools = (await connection.client.listTools()).filter(
      (tool) => (!include || matches(include, tool.name)) && !(exclude && matches(exclude, tool.name)),
    );
    connection.tools = tools.map((tool) => this.wrap(connection, tool));
    this.changed(connection);
  }

  private wrap(connection: Connection, tool: McpTool): ToolDefinition<any> {
    const { config, name: server } = connection;
    const prefix = config.prefix ?? server;
    const name = `${prefix}_${tool.name}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
    const { readOnly, approval } = mcpToolFlags(config, tool);
    const schema = tool.inputSchema ?? {};

    return {
      name,
      label: tool.title ?? tool.annotations?.title ?? humanize(tool.name),
      description: tool.description ?? `${tool.name} (from ${server})`,
      // Providers require an object schema, and some reject one without properties.
      parameters: Type.Unsafe({ ...schema, type: "object", properties: (schema.properties as object) ?? {} }),
      source: "mcp",
      server,
      readOnly,
      approval,
      roles: config.roles,
      execute: async (args, ctx) => {
        const client = connection.client;
        if (!client || connection.status !== "connected") throw new Error(`The ${server} integration is not connected right now.`);
        const result = await client.callTool(tool.name, args as Record<string, unknown>, {
          signal: ctx.signal,
          onProgress: (progress) => {
            if (progress.message) ctx.progress(progress.message);
            else if (progress.total) ctx.progress(`${Math.round((progress.progress / progress.total) * 100)}%`);
          },
        });
        const content = toLlmContent(result);
        const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
        const images = content.flatMap((block) => (block.type === "image" ? [{ data: block.data, mimeType: block.mimeType }] : []));
        return { text: text || "(no output)", images, isError: result.isError === true, data: result.structuredContent, ui: structuredUi(result.structuredContent) };
      },
    };
  }

  private describe(connection: Connection): McpServerInfo {
    const { config } = connection;
    return {
      name: connection.name,
      transport: "command" in config ? "stdio" : "http",
      target: "command" in config ? [config.command, ...(config.args ?? [])].join(" ") : redactUrl(config.url),
      status: connection.status,
      error: connection.error,
      tools: connection.tools.map((t) => t.name),
      runtime: connection.runtime,
    };
  }

  private changed(connection: Connection) {
    if (this.connections.get(connection.name) === connection) this.onChange(this.describe(connection));
  }
}

/**
 * Whether an MCP tool is read-only and whether it asks for approval. Server config wins over the
 * tool's own annotations: readOnlyHint marks it read-only, destructiveHint makes it ask.
 */
export function mcpToolFlags(
  config: Pick<McpServerConfig, "approval" | "readOnly">,
  tool: Pick<McpTool, "name" | "annotations">,
): { readOnly: boolean; approval: boolean } {
  const listed = (setting: McpToolFilter | undefined) =>
    typeof setting === "function" ? setting(tool.name) : setting === true || (Array.isArray(setting) && setting.includes(tool.name));
  const readOnly = listed(config.readOnly) || tool.annotations?.readOnlyHint === true;
  const approval = config.approval === undefined ? tool.annotations?.destructiveHint === true && !readOnly : listed(config.approval);
  return { readOnly, approval };
}

/**
 * Renders structured MCP results that are (or contain) files as a gallery, and lists of other
 * records as a table. A single file gets no title: its name is already under the preview.
 */
export function structuredUi(value: unknown): UiBlock[] | undefined {
  const direct = autoMedia(value) ?? autoTable(value);
  if (direct) return [direct];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const block = autoMedia(nested, Array.isArray(nested) ? humanize(key) : undefined) ?? autoTable(nested, humanize(key));
      if (block) return [block];
    }
  }
  return undefined;
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
