import type {
  AgentRuntimeConfig,
  AgentStorage,
  AgentUser,
  AppInfo,
  Awaitable,
  Hook,
  McpServerConfig,
  ModelsConfig,
  ScheduleDefinition,
  SubagentDefinition,
  ToolDefinition,
} from "@klymbak/server";
import type { Core } from "@strapi/strapi";

/** Strapi's built-in MCP server (Strapi 5.47+), called with one admin token. */
export interface StrapiMcpConfig {
  /** An admin token (Settings → Admin tokens). Its permissions cap what the agent can do. */
  token: string;
  /** Defaults to this server's own /mcp endpoint over loopback. */
  url?: string;
  /** Prefix for tool names. Default "strapi", giving strapi_list_article, strapi_create_article… */
  prefix?: string;
  /** Only users with one of these roles get the MCP tools. Default: everyone who can use the assistant. */
  roles?: string[];
  /**
   * Also load Strapi's per-content-type tools (list_article, create_article…). They cover the same
   * ground as the plugin's content tools but run as the token, so by default they are loaded only
   * when `contentTools` is off. The media library tools and tools from other plugins always load.
   */
  contentTools?: boolean;
}

/** What `extend` can add: anything that holds code rather than plain settings. */
export interface KlymbakExtension {
  tools?: ToolDefinition<any>[];
  hooks?: Hook[];
  subagents?: SubagentDefinition[];
  schedules?: ScheduleDefinition[] | false;
  mcpServers?: Record<string, McpServerConfig>;
  storage?: AgentStorage;
  /** Identity for schedules defined in config. Use a Strapi admin's id so content tools work. */
  systemUser?: AgentUser;
}

/**
 * The plugin's options, under `klymbak.config` in config/plugins.ts.
 *
 * Strapi merges plugin config with lodash's defaultsDeep, which copies plain objects and drops
 * symbol keys. Tool schemas rely on those, so tools, hooks and other code go in `extend`.
 */
export interface KlymbakConfig {
  /** Name, description and starter prompts shown in the assistant. */
  app?: AppInfo;
  /** Which models people can pick. Same shape as @klymbak/server's `models`. */
  models?: ModelsConfig;
  /** Added after the built-in instructions: your editorial rules, tone, glossary… */
  instructions?: string;
  /** Replaces the built-in instructions entirely. */
  systemPrompt?: string;
  /**
   * Tools that read and change content in-process as the signed-in admin, with their own Strapi
   * role permissions (fields, locales and conditions included). Default true.
   */
  contentTools?: boolean;
  /** Tools that search and read the Strapi docs on docs.strapi.io, for questions about Strapi itself. Default true. */
  docs?: boolean;
  /** Connect Strapi's MCP server as well. Off by default. */
  mcp?: StrapiMcpConfig | false;
  /** Where conversations and schedules are kept: Strapi's database (default) or memory. */
  storage?: "database" | "memory";
  /** Model turns per run before the agent stops. Default 24. */
  maxTurns?: number;
  /** How long an approval waits. Default 15 minutes. */
  approvalTimeoutMs?: number;
  /** Let super admins connect more MCP servers from the assistant's Tools panel. Default false. */
  runtimeMcp?: boolean;
  /** IANA timezone for dates and schedules. Default: the server's. */
  timezone?: string;
  /** Adds tools, hooks, subagents and schedules. Runs once, at bootstrap. */
  extend?: (context: { strapi: Core.Strapi }) => Awaitable<KlymbakExtension>;
}

export type ResolvedConfig = KlymbakConfig & Required<Pick<KlymbakConfig, "contentTools" | "docs" | "storage">>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Throws a readable error for config that would fail later in a confusing way. */
export function validateConfig(config: KlymbakConfig): void {
  check(isObject(config), "the config must be an object.");
  check(config.models === undefined || isObject(config.models), "`models` must be an object, e.g. { providers: [\"anthropic\"] }.");
  for (const key of ["instructions", "systemPrompt", "timezone"] as const) {
    check(config[key] === undefined || typeof config[key] === "string", `\`${key}\` must be a string.`);
  }
  check(config.contentTools === undefined || typeof config.contentTools === "boolean", "`contentTools` must be true or false.");
  check(config.docs === undefined || typeof config.docs === "boolean", "`docs` must be true or false.");
  check(config.storage === undefined || config.storage === "database" || config.storage === "memory", '`storage` must be "database" or "memory". Pass your own adapter through `extend`.');
  check(config.extend === undefined || typeof config.extend === "function", "`extend` must be a function returning { tools, hooks, subagents, schedules }.");
  for (const key of ["tools", "hooks", "subagents", "schedules", "mcpServers"]) {
    check(!(key in config), `\`${key}\` belongs in \`extend\`: Strapi's config merge would strip parts of it. Use extend: ({ strapi }) => ({ ${key}: … }).`);
  }
  if (config.mcp) {
    check(isObject(config.mcp), "`mcp` must be an object: { token } or false.");
    check(typeof config.mcp.token === "string" && config.mcp.token.length > 0, "`mcp.token` must be an admin token. Create one in Settings → Admin tokens.");
    check(config.mcp.url === undefined || typeof config.mcp.url === "string", "`mcp.url` must be a URL string.");
    check(config.mcp.contentTools === undefined || typeof config.mcp.contentTools === "boolean", "`mcp.contentTools` must be true or false.");
  }
}

export const config = {
  default: { contentTools: true, docs: true, storage: "database" } satisfies KlymbakConfig,
  validator: validateConfig,
};

/** Runtime options that pass straight through to @klymbak/server. */
export function runtimeOptions(config: ResolvedConfig): Partial<AgentRuntimeConfig> {
  return {
    app: config.app,
    maxTurns: config.maxTurns,
    approvalTimeoutMs: config.approvalTimeoutMs,
    timezone: config.timezone,
    runtimeMcp: config.runtimeMcp ? { roles: ["strapi-super-admin"] } : false,
  };
}
