import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // Strapi's MCP server at /mcp. The assistant uses it when KLYMBAK_MCP_TOKEN is set.
  mcp: {
    enabled: env.bool('MCP_ENABLED', true),
  },
});

export default config;
