import type { AgentUser, Hook } from "@klymbak/server";
import type { Core } from "@strapi/strapi";
import { loadActor } from "./content/access.ts";
import { hasDraftAndPublish, isLocalized, isSingleType } from "./content/model.ts";
import { readableContentTypes } from "./content/tools.ts";

/** What the model is told about this Strapi project when a conversation starts. */
export interface ProjectFacts {
  version: string;
  /** Running under `strapi develop`, where the Content-type Builder can change the content model. */
  development: boolean;
  /** Undefined without a license (Community Edition). */
  license?: { type?: string; features: string[] };
  locales: { name: string; code: string; isDefault: boolean }[];
  plugins: string[];
  /** The person's Strapi role names. */
  roles?: string[];
  /** Content types the person can read. Undefined when the content tools are off. */
  contentTypes?: { name: string; uid: string; kind: "single" | "collection"; draftAndPublish: boolean; localized: boolean; may: string[] }[];
}

/** Always installed, or this plugin: listing them tells the model nothing. */
const IMPLIED_PLUGINS = new Set(["content-manager", "content-type-builder", "klymbak"]);
/** Names editors and the docs use for Strapi's own plugins. */
const PLUGIN_NAMES: Record<string, string> = {
  upload: "Media Library",
  i18n: "Internationalization",
  "content-releases": "Releases",
  "review-workflows": "Review Workflows",
  "users-permissions": "Users & Permissions",
  email: "Email",
  graphql: "GraphQL",
  documentation: "API documentation",
};
const MAX_CONTENT_TYPES = 40;

export async function projectFacts(strapi: Core.Strapi, user: AgentUser, options: { contentTypes: boolean }): Promise<ProjectFacts> {
  const ee = (strapi as unknown as { EE?: boolean; ee?: { type?: string; features?: { list(): (string | { name: string })[] } } });
  const i18n = strapi.plugin("i18n")?.service("locales");
  const locales = ((await i18n?.find()) ?? []) as { name: string; code: string }[];
  const defaultLocale = (await i18n?.getDefaultLocale()) as string | undefined;
  const facts: ProjectFacts = {
    version: String(strapi.config.get("info.strapi") ?? "5"),
    development: strapi.config.get("autoReload") === true,
    license: ee.EE ? { type: ee.ee?.type, features: (ee.ee?.features?.list() ?? []).map((f) => (typeof f === "string" ? f : f.name)) } : undefined,
    locales: locales.map((locale) => ({ name: locale.name, code: locale.code, isDefault: locale.code === defaultLocale })),
    plugins: Object.keys(strapi.plugins).filter((name) => !IMPLIED_PLUGINS.has(name)),
  };
  try {
    const actor = await loadActor(strapi, user);
    facts.roles = (actor.admin.roles ?? []).map((role) => role.name ?? role.code);
    if (options.contentTypes) {
      facts.contentTypes = readableContentTypes(strapi, actor).map(({ model, may }) => ({
        name: model.info.displayName,
        uid: model.uid,
        kind: isSingleType(model) ? "single" : "collection",
        draftAndPublish: hasDraftAndPublish(model),
        localized: isLocalized(model),
        may,
      }));
    }
  } catch {
    // Not a Strapi admin (e.g. a config schedule without systemUser): the content tools say so when called.
  }
  return facts;
}

export function describeProject(facts: ProjectFacts): string {
  const plugin = (name: string) => (PLUGIN_NAMES[name] ? `${PLUGIN_NAMES[name]} (${name})` : name);
  // Strapi names locales "English (en)", but names can be edited.
  const locale = ({ name, code }: { name: string; code: string }) => (name.includes(code) ? name : `${name} (${code})`);
  // Locales exist project-wide, but only localized types have a version per locale.
  const localized = facts.contentTypes?.filter((type) => type.localized).map((type) => type.name);
  const localizedNote = !localized
    ? ""
    : localized.length
      ? ` Localized content types (one version per locale): ${localized.join(", ")}; the others have one version.`
      : " No content type the person can read is localized: each entry has one version, whatever the locale, until Internationalization is enabled for its type in the Content-type Builder.";
  const lines = [
    "## This Strapi project",
    `- Strapi ${facts.version}, ${
      facts.license
        ? `licensed (${facts.license.type ?? "paid plan"}${facts.license.features.length ? `; features: ${facts.license.features.join(", ")}` : ""})`
        : "Community Edition without a license. Docs pages say which plan a feature needs"
    }.`,
    facts.development
      ? "- Running in development mode (`strapi develop`): the Content-type Builder can change content types and components. Saving there restarts the server."
      : "- Not in development mode: content types can't be changed from the admin. Developers change them in code (or run `strapi develop` locally) and deploy.",
    facts.locales.length
      ? `- Locales: ${facts.locales.map((l) => `${locale(l)}${l.isDefault ? ", default" : ""}`).join("; ")}.${localizedNote}`
      : "- Internationalization is off: content has one locale.",
    `- Plugins: ${facts.plugins.length ? facts.plugins.map(plugin).join(", ") : "none beyond the core"}.`,
    facts.roles?.length ? `- The person's Strapi role: ${facts.roles.join(", ")}.` : "",
  ];
  if (facts.contentTypes) {
    const shown = facts.contentTypes.slice(0, MAX_CONTENT_TYPES);
    lines.push(
      shown.length ? "- Content types the person can read (list_content_types shows their fields):" : "- The person's role can't read any content types.",
      ...shown.map((type) => {
        const traits = [type.kind, type.draftAndPublish ? "Draft & Publish" : "", type.localized ? "localized" : ""].filter(Boolean).join(", ");
        return `  - ${type.name} (${type.uid}): ${traits}. Can ${["read", ...type.may].join(", ")}.`;
      }),
      facts.contentTypes.length > shown.length ? `  - …and ${facts.contentTypes.length - shown.length} more: call list_content_types.` : "",
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** Tells each new conversation what this project is: version, mode, locales, plugins and content model. */
export function projectContext(strapi: Core.Strapi, options: { contentTypes: boolean }): Hook {
  return {
    name: "strapi-project",
    sessionStart: async ({ ctx }) => {
      try {
        return { context: describeProject(await projectFacts(strapi, ctx.user, options)) };
      } catch (error) {
        strapi.log.warn(`[klymbak] couldn't describe the project to the assistant: ${String(error)}`);
      }
    },
  };
}
