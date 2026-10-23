import { useCallback, useMemo } from "react";
import { useIntl } from "react-intl";
import { loadMessages, type AppInfo, type Messages } from "@klymbak/react";
import { PLUGIN_ID } from "./agent";
import en from "./translations/en.json";

export type TranslationId = keyof typeof en;

/** Where the chat's own words live among the admin's messages, so a project can override them like any other. */
const UI_PREFIX = `${PLUGIN_ID}.ui.`;

function prefixed(messages: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).map(([id, text]) => [`${prefix}${id}`, text]));
}

/**
 * The plugin's messages in one of the admin's languages, for Strapi's `registerTrads`: its own under `klymbak.*` and
 * the chat's (from `@klymbak/client`'s catalogs) under `klymbak.ui.*`. A language without a file gets none, and the
 * admin falls back to English.
 */
export async function translations(locale: string): Promise<Record<string, string>> {
  const [own, ui] = await Promise.all([
    import(`./translations/${locale}.json`).then((module: { default: Record<string, string> }) => module.default).catch(() => ({})),
    // Strapi's "zh" is Traditional Chinese, which Klymbak has no messages for; BCP 47 would read it as Simplified.
    loadMessages(locale === "zh" ? "zh-Hant" : locale),
  ]);
  return { ...prefixed(own, `${PLUGIN_ID}.`), ...prefixed(ui ?? {}, UI_PREFIX) };
}

/** The plugin's own words in the admin's language. */
export function useT() {
  const { formatMessage } = useIntl();
  return useCallback(
    (id: TranslationId, values?: Record<string, string | number>) => formatMessage({ id: `${PLUGIN_ID}.${id}`, defaultMessage: en[id] }, values),
    [formatMessage],
  );
}

/** The admin's language and the chat's messages in it, for the Klymbak components' `locale` and `messages`. */
export function useAgentI18n(): { locale: string; messages: Partial<Messages> } {
  const { locale, messages } = useIntl();
  return useMemo(() => {
    const ui: Record<string, string> = {};
    for (const [id, text] of Object.entries(messages)) {
      if (id.startsWith(UI_PREFIX) && typeof text === "string") ui[id.slice(UI_PREFIX.length)] = text;
    }
    return { locale, messages: ui };
  }, [locale, messages]);
}

/**
 * The name, description and starter prompts to show: what the project set in the plugin's `app` config, and for
 * anything it left out, the plugin's own in the admin's language. Undefined until the config has loaded.
 */
export function useAppTexts(app: AppInfo | undefined) {
  const t = useT();
  if (!app) return {};
  return {
    title: app.name || t("plugin.name"),
    description: app.description ?? t("app.description"),
    suggestions: app.suggestions ?? [t("app.suggestion.1"), t("app.suggestion.2"), t("app.suggestion.3"), t("app.suggestion.4")],
  };
}
