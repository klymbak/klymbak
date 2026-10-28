/** Raw entries as Strapi's REST API returns them, minus ids and timestamps. */
export type Entry = Record<string, any>;

/** A site's published content in every locale it has; also the committed fallback (snapshot.json). */
export interface Snapshot {
  site: string;
  defaultLocale: string;
  locales: Record<string, { site: Entry; pages: Entry[]; uiTexts: Entry[] }>;
}

export interface Source {
  url: string;
  token: string;
  /** The Site entry's key. */
  site: string;
}

const DROP = new Set(["id", "documentId", "createdAt", "updatedAt", "publishedAt", "locale", "localizations"]);

/** Ids and timestamps change on every edit and say nothing about the content, so the snapshot leaves them out. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  const entry = value as Entry;
  // An uploaded file: keep what a page needs to show it.
  if (typeof entry.mime === "string" && typeof entry.url === "string") {
    return { url: entry.url, alternativeText: entry.alternativeText ?? null, width: entry.width ?? null, height: entry.height ?? null };
  }
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !DROP.has(key)).map(([key, item]) => [key, clean(item)]));
}

/** Reads a site's published content: the site, its pages and its UI texts, in each locale the site has. */
export async function fetchSnapshot({ url, token, site }: Source): Promise<Snapshot> {
  const get = async (path: string): Promise<Entry[]> => {
    const response = await fetch(`${url}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`GET /api${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return ((await response.json()) as { data: Entry[] }).data;
  };
  const key = `filters[key][$eq]=${encodeURIComponent(site)}`;
  const scope = `filters[site][key][$eq]=${encodeURIComponent(site)}&pagination[pageSize]=100`;

  // Without a locale, Strapi answers in its default one; the site's other locales come with it.
  const [first] = await get(`/sites?${key}&fields[0]=locale&populate[localizations][fields][0]=locale`);
  if (!first) throw new Error(`Strapi at ${url} has no site "${site}" in its default locale.`);
  const others = (first.localizations as { locale: string }[]).map((entry) => entry.locale).sort();

  const locales: Snapshot["locales"] = {};
  for (const locale of [first.locale as string, ...others]) {
    const [entry] = await get(`/sites?${key}&locale=${locale}`);
    locales[locale] = {
      site: clean(entry) as Entry,
      pages: (await get(`/pages?${scope}&locale=${locale}&sort[0]=slug`)).map((page) => clean(page) as Entry),
      uiTexts: (await get(`/ui-texts?${scope}&locale=${locale}&sort[0]=name`)).map((text) => clean(text) as Entry),
    };
  }
  return { site, defaultLocale: first.locale, locales };
}
