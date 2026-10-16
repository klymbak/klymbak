import type { Core } from '@strapi/strapi';
import { lmStudio, ollama, type KlymbakConfig } from '@klymbak/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedTypes = [
  'image/svg+xml',
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const mcpToken = env('KLYMBAK_MCP_TOKEN');
  const klymbak: KlymbakConfig = {
    app: {
      name: 'Field Notes assistant',
      description: 'Find, write and update blog content in plain language. Every change waits for your approval.',
      suggestions: [
        'Which drafts are not ready to publish yet?',
        'Which articles have no category or description?',
        'Draft an article about winter birdwatching in the style of our nature posts',
        'Translate the About page title into French',
      ],
    },
    instructions:
      'This is Field Notes, a small blog about technology, food and nature. Articles are short, plain and specific: a description of one sentence, then a few paragraphs. Every article should have a title, a slug, a description, a category and an author before it is published.',
    models: {
      providers: ['anthropic', 'openai', 'google', 'openrouter'],
      custom: env.bool('LOCAL_MODELS', true)
        ? [
            lmStudio({ baseUrl: env('LMSTUDIO_BASE_URL', 'http://localhost:1234/v1') }),
            ollama({ baseUrl: env('OLLAMA_BASE_URL', 'http://localhost:11434/v1') }),
          ]
        : [],
      default: env.array('AGENT_DEFAULT_MODEL', [
        'anthropic/claude-sonnet-5-5',
        'openai/gpt-6.1-sol',
        'google/gemini-3.8-flash',
        'lmstudio/qwen/qwen3.8-27b',
      ]),
    },
    // Strapi's own MCP server, called with one admin token, alongside the in-process content tools.
    mcp: mcpToken ? { token: mcpToken } : false,
  };

  return {
    klymbak: { config: klymbak },
    'users-permissions': {
      config: {
        jwtManagement: 'refresh',
        sessions: {
          httpOnly: true,
        },
      },
    },
    upload: {
      config: {
        security: {
          allowedTypes: allowedMediaTypes,
          deniedTypes,
        },
      },
    },
  };
};

export default config;
