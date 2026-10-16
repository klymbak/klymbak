import type { McpHttpServerConfig } from "@klymbak/server";
import type { StrapiMcpConfig } from "./config.ts";

/**
 * Strapi's MCP tools that only read: list_<type>, get_<type>, media_list_*, media_get_* and the
 * development-only log tool. Strapi sets no MCP annotations, so everything else (create, update,
 * write, delete, publish, unpublish, discard_*_draft, media moves and deletes, and tools other
 * plugins register later) is treated as a change that needs approval.
 */
export const isReadOnlyStrapiTool = (name: string) => /^(list|get)_/.test(name) || /^media_(list|get)_/.test(name) || name === "log";

/** Strapi's per-content-type MCP tools, which the plugin's own content tools replace. */
export const isStrapiContentTool = (name: string) => /^(list|get|create|update|write|delete|publish|unpublish)_/.test(name) || /^discard_.+_draft$/.test(name);

/** Where this Strapi server can reach its own /mcp endpoint. */
export function loopbackUrl(server: { host?: string; port?: number | string }): string {
  const host = !server.host || server.host === "0.0.0.0" || server.host === "::" ? "127.0.0.1" : server.host;
  const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${hostname}:${server.port ?? 1337}/mcp`;
}

export function strapiMcpServer(
  config: StrapiMcpConfig,
  server: { host?: string; port?: number | string },
  options: { contentTools: boolean },
): McpHttpServerConfig {
  return {
    url: config.url ?? loopbackUrl(server),
    headers: { authorization: `Bearer ${config.token}` },
    prefix: config.prefix ?? "strapi",
    roles: config.roles,
    exclude: (config.contentTools ?? !options.contentTools) ? undefined : isStrapiContentTool,
    readOnly: isReadOnlyStrapiTool,
    approval: (name) => !isReadOnlyStrapiTool(name),
  };
}
