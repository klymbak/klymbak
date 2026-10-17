import type { Core } from "@strapi/strapi";
import { config } from "./config.ts";
import { contentTypes } from "./content-types/index.ts";
import { agentService, PLUGIN_ID, USE_ACTION, type AgentContext, type AgentService } from "./service.ts";

const service = (strapi: Core.Strapi) => strapi.plugin(PLUGIN_ID).service("agent") as AgentService;

const routes = {
  admin: {
    type: "admin",
    routes: (["GET", "POST", "PATCH", "DELETE"] as const).map((method) => ({
      method,
      path: "/agent/(.*)",
      handler: "agent.handle",
      config: {
        policies: ["admin::isAuthenticatedAdmin", { name: "admin::hasPermissions", config: { actions: [USE_ACTION] } }],
      },
    })),
  },
};

const plugin = {
  config,
  contentTypes,
  routes,
  services: { agent: agentService },
  controllers: {
    agent: ({ strapi }: { strapi: Core.Strapi }) => ({
      handle: (ctx: AgentContext) => service(strapi).handle(ctx),
    }),
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Super admins get it automatically; grant it to other roles in Settings → Roles → Plugins.
    await strapi.service("admin::permission").actionProvider.registerMany([
      { section: "plugins", displayName: "Use the assistant", uid: "use", pluginName: PLUGIN_ID },
    ]);
    const agent = service(strapi);
    await agent.init();
    // Strapi's MCP endpoint is served by this same process, so connect once it is listening.
    // Scripts that never listen (strapi console, migrations) start the agent on first use.
    strapi.server.httpServer.once("listening", () => {
      agent.start().catch((error: unknown) => strapi.log.error(`[klymbak] The assistant failed to start: ${String(error)}`));
    });
  },

  async destroy({ strapi }: { strapi: Core.Strapi }) {
    await service(strapi).stop();
  },
};

export default plugin;

export type { KlymbakConfig, KlymbakExtension, StrapiMcpConfig } from "./config.ts";
export type { AgentService } from "./service.ts";
export { OPEN_ENTRY_EVENT } from "./content/tools.ts";
export { isReadOnlyStrapiTool } from "./mcp.ts";
export { toAgentUser } from "./auth.ts";

// The @klymbak/server helpers you need in config/plugins.ts and in `extend`.
export {
  auditTrail,
  defineTool,
  lmStudio,
  loadSkills,
  ollama,
  openAICompatible,
  parseSkill,
  redactPii,
  requireApproval,
  StringEnum,
  Type,
  ui,
} from "@klymbak/server";
export type { AgentUser, Hook, ScheduleDefinition, SkillDefinition, SubagentDefinition, ToolDefinition } from "@klymbak/server";
