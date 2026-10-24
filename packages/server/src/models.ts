import {
  clampThinkingLevel,
  createModels,
  createProvider,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { formatModelRef, parseModelRef, type ModelInfo, type ModelRef, type ThinkingLevel } from "@klymbak/protocol";
import { agentError } from "./errors.ts";
import type { CustomModelConfig, Logger, ModelsConfig, OpenAICompatibleProviderConfig } from "./types.ts";

const CACHE_MS = 15_000;

/**
 * Wraps pi-ai's `Models` collection: which providers are enabled, which of their
 * models users may pick, and how a session's model choice resolves to a pi Model.
 */
export class ModelRegistry {
  readonly models: MutableModels;
  readonly streamFn: StreamFn;
  private readonly allow: RegExp[];
  private readonly localProviders = new Set<string>();
  private cache?: { at: number; list: Model<Api>[] };
  private readonly config: ModelsConfig;
  private readonly logger: Logger;

  private constructor(config: ModelsConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.models = createModels();
    this.allow = (config.allow ?? []).map(globToRegExp);
    this.streamFn = (model, context, options) => this.models.streamSimple(model, context, options);
  }

  static async create(config: ModelsConfig, logger: Logger): Promise<ModelRegistry> {
    const registry = new ModelRegistry(config, logger);
    await registry.registerProviders();
    return registry;
  }

  private async registerProviders() {
    const wanted = this.config.providers;
    const objects = (wanted ?? []).filter((p): p is Provider => typeof p !== "string");
    const ids = wanted === undefined ? undefined : new Set(wanted.filter((p): p is string => typeof p === "string"));
    if (ids === undefined || ids.size > 0) {
      const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
      for (const provider of builtinProviders()) {
        if (!ids || ids.has(provider.id)) this.models.setProvider(provider);
      }
    }
    for (const provider of objects) this.models.setProvider(provider);
    for (const custom of this.config.custom ?? []) {
      this.models.setProvider(openAICompatibleProvider(custom));
      if (custom.local ?? isLocalUrl(custom.baseUrl)) this.localProviders.add(custom.id);
    }
  }

  /** Re-fetches dynamic model lists (custom providers with discovery). */
  async refresh(): Promise<void> {
    const dynamic = (this.config.custom ?? []).filter((c) => c.discover).map((c) => c.id);
    if (dynamic.length) {
      const result = await this.models.refresh({ providers: dynamic, signal: AbortSignal.timeout(8_000) });
      for (const [provider, error] of result.errors) {
        const cause = (error as { cause?: { code?: string } })?.cause?.code;
        const reason = cause === "ECONNREFUSED" ? "server not running" : cause ?? (error instanceof Error ? error.message : String(error));
        this.logger.warn(`Skipping ${provider} models (${reason})`);
      }
    }
    this.cache = undefined;
  }

  /** Models whose provider is configured (credentials present) and that pass the allow list. */
  async available(): Promise<Model<Api>[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.list;
    let list = [...(await this.models.getAvailable())];
    if (this.allow.length) list = list.filter((m) => this.allow.some((re) => re.test(`${m.provider}/${m.id}`)));
    list.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
    this.cache = { at: Date.now(), list };
    return list;
  }

  async list(): Promise<ModelInfo[]> {
    return (await this.available()).map((model) => this.info(model));
  }

  info(model: Model<Api>): ModelInfo {
    return {
      provider: model.provider,
      providerName: this.models.getProvider(model.provider)?.name ?? model.provider,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      input: [...model.input],
      cost: { input: model.cost.input, output: model.cost.output },
      thinkingLevels: model.reasoning ? (getSupportedThinkingLevels(model) as ThinkingLevel[]) : ["off"],
      local: this.localProviders.has(model.provider) || undefined,
    };
  }

  async defaultRef(): Promise<ModelRef | undefined> {
    const available = await this.available();
    const preferred = this.config.default === undefined ? [] : [this.config.default].flat();
    for (const value of preferred) {
      const ref = parseModelRef(value);
      if (ref && available.some((m) => m.provider === ref.provider && m.id === ref.id)) return ref;
    }
    const first = available[0];
    return first ? { provider: first.provider, id: first.id } : undefined;
  }

  /** Resolves a model choice, falling back to the default. Throws when nothing is usable. */
  async resolve(ref?: ModelRef): Promise<Model<Api>> {
    const available = await this.available();
    const target = ref ?? (await this.defaultRef());
    if (!target) {
      throw agentError(503, "error.noModels", "no_models");
    }
    const model = available.find((m) => m.provider === target.provider && m.id === target.id);
    if (!model) throw agentError(400, "error.modelUnavailable", "model_unavailable", { model: formatModelRef(target) });
    return model;
  }

  clampThinking(model: Model<Api>, level: ThinkingLevel | undefined): ThinkingLevel {
    if (!model.reasoning || !level) return "off";
    return clampThinkingLevel(model, level) as ThinkingLevel;
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible providers
// ---------------------------------------------------------------------------

export function openAICompatibleProvider(config: OpenAICompatibleProviderConfig): Provider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const toModel = (input: string | CustomModelConfig): Model<"openai-completions"> => {
    const spec = typeof input === "string" ? { id: input } : input;
    return {
      id: spec.id,
      name: spec.name ?? spec.id,
      api: "openai-completions",
      provider: config.id,
      baseUrl,
      reasoning: spec.reasoning ?? config.reasoning ?? false,
      input: spec.vision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: spec.contextWindow ?? config.contextWindow ?? 32_768,
      maxTokens: spec.maxTokens ?? config.maxTokens ?? 8_192,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, ...config.compat },
    };
  };

  const apiKey = () => config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);

  return createProvider({
    id: config.id,
    name: config.name ?? config.id,
    baseUrl,
    auth: {
      apiKey: {
        name: `${config.name ?? config.id} API key`,
        // Keyless local servers still need a placeholder for the OpenAI SDK.
        resolve: async () => {
          const key = apiKey();
          if (config.apiKeyEnv && !key) return undefined;
          return { auth: { apiKey: key ?? "not-needed" }, source: key ? "configured key" : "keyless" };
        },
      },
    },
    models: (config.models ?? []).map(toModel),
    fetchModels: config.discover
      ? async ({ signal }) => {
          const discovered =
            config.discover === "lmstudio"
              ? await discoverLmStudio(baseUrl, signal)
              : await discoverOpenAI(baseUrl, apiKey(), signal);
          const overrides = new Map(
            (config.models ?? []).flatMap((m) => (typeof m === "string" ? [] : [[m.id, m] as const])),
          );
          return discovered.map((spec) => toModel({ ...spec, ...overrides.get(spec.id) }));
        }
      : undefined,
    api: openAICompletionsApi(),
  }) as Provider;
}

async function discoverOpenAI(baseUrl: string, apiKey: string | undefined, signal: AbortSignal): Promise<CustomModelConfig[]> {
  const response = await fetch(`${baseUrl}/models`, {
    signal,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) throw new Error(`GET ${baseUrl}/models failed with ${response.status}`);
  const body = (await response.json()) as { data?: { id: string }[] };
  return (body.data ?? []).filter((m) => !/embed|rerank|whisper|tts/i.test(m.id)).map((m) => ({ id: m.id }));
}

interface LmStudioModel {
  id: string;
  type?: string;
  state?: string;
  max_context_length?: number;
  loaded_context_length?: number;
  capabilities?: string[];
}

/** LM Studio's native endpoint reports model type, tool support and context length. */
async function discoverLmStudio(baseUrl: string, signal: AbortSignal): Promise<CustomModelConfig[]> {
  const origin = new URL(baseUrl).origin;
  const response = await fetch(`${origin}/api/v0/models`, { signal });
  if (!response.ok) return discoverOpenAI(baseUrl, undefined, signal);
  const body = (await response.json()) as { data?: LmStudioModel[] };
  return (body.data ?? [])
    .filter((m) => m.type === "llm" || m.type === "vlm")
    .filter((m) => !m.capabilities || m.capabilities.includes("tool_use"))
    .map((m) => ({
      id: m.id,
      vision: m.type === "vlm",
      contextWindow: m.loaded_context_length ?? Math.min(m.max_context_length ?? 32_768, 32_768),
    }));
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** LM Studio's local server (default http://localhost:1234). Models are discovered. */
export function lmStudio(options: Partial<OpenAICompatibleProviderConfig> = {}): OpenAICompatibleProviderConfig {
  return {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    discover: "lmstudio",
    reasoning: false,
    local: true,
    ...options,
  };
}

/** Ollama's OpenAI-compatible endpoint (default http://localhost:11434). Models are discovered. */
export function ollama(options: Partial<OpenAICompatibleProviderConfig> = {}): OpenAICompatibleProviderConfig {
  return {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    discover: true,
    local: true,
    ...options,
  };
}

export function openAICompatible(config: OpenAICompatibleProviderConfig): OpenAICompatibleProviderConfig {
  return config;
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`, "i");
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return false;
  }
}
