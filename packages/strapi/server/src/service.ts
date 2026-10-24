import path from "node:path";
import { createAgentServer, loadSkills, memoryStorage, type AgentServer, type AgentUser, type AppInfo, type Logger } from "@klymbak/server";
import type { Core } from "@strapi/strapi";
import { toAgentUser, type StrapiAdminUser } from "./auth.ts";
import { runtimeOptions, type ResolvedConfig } from "./config.ts";
import { contentTools } from "./content/tools.ts";
import { sendResponse, toRequest, type KoaContext } from "./koa.ts";
import { strapiMcpServer } from "./mcp.ts";
import { docsTools } from "./docs.ts";
import { projectContext } from "./project.ts";
import { DOCS_PROMPT, MCP_PROMPT, STRAPI_PROMPT } from "./prompt.ts";
import { databaseStorage } from "./storage.ts";

export const PLUGIN_ID = "klymbak";
export const USE_ACTION = `plugin::${PLUGIN_ID}.use`;

/**
 * Sent when the project configures no `app`. Whatever is missing, the admin fills in from its translations, so the
 * name, description and starter prompts appear in each admin's language.
 */
const DEFAULT_APP: AppInfo = { name: "" };

function strapiLogger(strapi: Core.Strapi): Logger {
  const line = (message: string, data?: unknown) =>
    `[klymbak] ${message}${data === undefined || data === "" ? "" : ` ${typeof data === "string" ? data : JSON.stringify(data)}`}`;
  return {
    info: (message, data) => strapi.log.info(line(message, data)),
    warn: (message, data) => strapi.log.warn(line(message, data)),
    error: (message, data) => strapi.log.error(line(message, data)),
  };
}

export type AgentContext = KoaContext & { state: { user?: StrapiAdminUser } };

/**
 * The plugin's agent: @klymbak/server configured from the plugin config, plus the bridge that
 * serves its HTTP API from Strapi's admin routes. Available as strapi.plugin("klymbak").service("agent").
 */
export function agentService({ strapi }: { strapi: Core.Strapi }) {
  let server: AgentServer | undefined;
  /** Who sent each request; the admin auth strategy already checked them. */
  const callers = new WeakMap<Request, AgentUser>();

  async function build(): Promise<AgentServer> {
    const config = strapi.config.get(`plugin::${PLUGIN_ID}`) as ResolvedConfig;
    const extension = (await config.extend?.({ strapi })) ?? {};
    const mcpServers = { ...extension.mcpServers };
    if (config.mcp) {
      const server = strapi.config.get("server") as { host?: string; port?: number };
      mcpServers.strapi = strapiMcpServer(config.mcp, server, { contentTools: config.contentTools });
    }
    const skills = [...(config.skills ? await loadSkills(path.resolve(strapi.dirs.app.root, config.skills)) : []), ...(extension.skills ?? [])];
    const prompt = [STRAPI_PROMPT, config.mcp && config.contentTools ? MCP_PROMPT : undefined, config.docs ? DOCS_PROMPT : undefined, config.instructions];

    return createAgentServer({
      ...runtimeOptions(config),
      app: config.app ?? DEFAULT_APP,
      systemPrompt: config.systemPrompt ?? prompt.filter(Boolean).join("\n\n"),
      models: config.models ?? {},
      tools: [...(config.contentTools ? contentTools(strapi) : []), ...(config.docs ? docsTools() : []), ...(extension.tools ?? [])],
      hooks: [projectContext(strapi, { contentTypes: config.contentTools }), ...(extension.hooks ?? [])],
      subagents: extension.subagents,
      skills,
      schedules: extension.schedules,
      mcpServers,
      storage: extension.storage ?? (config.storage === "memory" ? memoryStorage() : databaseStorage(strapi)),
      systemUser: extension.systemUser,
      logger: strapiLogger(strapi),
      auth: (request) => callers.get(request),
    });
  }

  return {
    async init() {
      server = await build();
    },

    /** Connects models and MCP servers and starts the scheduler. Safe to call more than once. */
    async start() {
      await server?.start();
    },

    async stop() {
      await server?.stop();
      server = undefined;
    },

    /** The agent runtime, for running prompts from your own code (runHeadless, startRun…). */
    get runtime() {
      return server?.runtime;
    },

    /** Serves one request to the agent's API: `/agent/<path>` under the plugin's admin routes. */
    async handle(ctx: AgentContext) {
      if (!server) {
        ctx.status = 503;
        ctx.body = { error: "The assistant is still starting. Try again in a moment.", code: "starting" };
        return;
      }
      if (!ctx.state.user) {
        ctx.status = 401;
        ctx.body = { error: "Sign in to use the assistant.", code: "unauthorized" };
        return;
      }
      const path = ctx.params?.[0] ?? ctx.path.replace(/^.*?\/agent(?=\/|$)/, "");
      const request = toRequest(ctx, path || "/");
      callers.set(request, toAgentUser(ctx.state.user));
      await sendResponse(ctx, await server.fetch(request));
    },
  };
}

export type AgentService = ReturnType<typeof agentService>;
