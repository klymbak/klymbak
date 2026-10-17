import { autoMedia, defineTool, StringEnum, Type, ui, type AgentUser, type TableColumn, type ToolDefinition, type ToolOutput, type UiAction } from "@klymbak/server";
import type { Core, UID } from "@strapi/strapi";
import { ContentToolError, describeError, forbidden, loadActor, permissionChecker, type Actor, type PermissionChecker } from "./access.ts";
import {
  buildPopulate,
  describeModel,
  editableAttributes,
  guessMainField,
  hasDraftAndPublish,
  isLocalized,
  isSingleType,
  type Attribute,
  type GetModel,
  type Model,
} from "./model.ts";
import { imageLookup, uploadMediaTool } from "./media.ts";
import { entryMedia, normalizeInput, removedFields, shapeEntry } from "./shape.ts";

/** Emitted by "Open" buttons; the admin UI navigates to the entry in the Content Manager. */
export const OPEN_ENTRY_EVENT = "strapi.open_entry";

const MAX_PAGE_SIZE = 100;
const DEPTH = 5;
/** Field types left out of lists unless asked for: long or structured. */
const HEAVY_TYPES = new Set(["richtext", "blocks", "json", "password", "dynamiczone", "component"]);
const COLUMN_TYPES = new Set(["string", "email", "enumeration", "integer", "biginteger", "decimal", "float", "boolean", "date", "datetime", "uid"]);

type Entry = Record<string, any>;

const contentTypeParam = Type.String({ description: 'Content type UID from list_content_types, e.g. "api::article.article".' });
const documentIdParam = Type.Optional(Type.String({ description: "The entry's documentId. Leave out for single types." }));
const localeParam = Type.Optional(Type.String({ description: 'Locale code, e.g. "en" or "fr", for localized types. Default: the default locale.' }));
/** A free-form object. Record types become patternProperties, which some providers reject. */
const anyObject = (description: string) => Type.Object({}, { additionalProperties: true, description });

/** Content types shown in the Content Manager, i.e. the ones editors work with. */
export function displayedContentTypes(strapi: Core.Strapi): Model[] {
  const shown = new Set<string>(
    strapi.plugin("content-manager").service("content-types").findDisplayedContentTypes().map((type: { uid: string }) => type.uid),
  );
  return Object.values(strapi.contentTypes as unknown as Record<string, Model>).filter((model) => shown.has(model.uid) && !model.uid.startsWith("admin::"));
}

/** The content types a person can read, with the other actions their role allows on each. */
export function readableContentTypes(strapi: Core.Strapi, actor: Actor): { model: Model; may: ("create" | "update" | "delete" | "publish")[] }[] {
  return displayedContentTypes(strapi).flatMap((model) => {
    const pc = permissionChecker(strapi, actor.ability, model.uid);
    if (!pc.can.read()) return [];
    const may = (["create", "update", "delete", "publish"] as const).filter((action) => (action !== "publish" || hasDraftAndPublish(model)) && pc.can[action]());
    return [{ model, may }];
  });
}

/**
 * In-process content tools. Every call runs as the signed-in Strapi admin: their role decides
 * which content types, entries, fields and locales they can read or change (conditions such as
 * "only entries they created" included), exactly as in the Content Manager.
 */
export function contentTools(strapi: Core.Strapi): ToolDefinition<any>[] {
  const getModel: GetModel = (uid) => strapi.getModel(uid as UID.Schema) as unknown as Model | undefined;
  const documents = (uid: string) => strapi.documents(uid as UID.ContentType) as any;
  const cm = () => strapi.plugin("content-manager");
  const labels = new Map<string, string>();

  function contentType(uid: string): Model {
    const model = displayedContentTypes(strapi).find((type) => type.uid === uid);
    if (!model) throw new ContentToolError(`There is no content type "${uid}". Call list_content_types to see the UIDs.`);
    return model;
  }

  /** The field the Content Manager uses to name entries of a type (its "main field"). */
  async function labelField(uid: string): Promise<string> {
    const cached = labels.get(uid);
    if (cached) return cached;
    const model = getModel(uid);
    let field = model ? guessMainField(model) : "documentId";
    try {
      const configured = (await cm().service("content-types").findConfiguration({ uid }))?.settings?.mainField;
      if (typeof configured === "string" && (configured === "documentId" || model?.attributes[configured])) field = configured;
    } catch {
      // Not every type has a stored configuration; the guess is fine.
    }
    labels.set(uid, field);
    return field;
  }

  /** Related types' label fields, where the person may read that type. */
  async function relationLabels(actor: Actor, model: Model): Promise<(uid: string) => string | undefined> {
    const targets = new Set<string>();
    const visit = (attributes: Record<string, Attribute>, depth: number, seen: Set<string>) => {
      for (const attribute of Object.values(attributes)) {
        if (attribute.type === "relation" && attribute.target) targets.add(attribute.target);
        const nested = attribute.type === "component" ? [attribute.component!] : attribute.type === "dynamiczone" ? (attribute.components ?? []) : [];
        for (const uid of nested) {
          const component = getModel(uid);
          if (component && depth < DEPTH && !seen.has(uid)) visit(component.attributes, depth + 1, new Set([...seen, uid]));
        }
      }
    };
    visit(model.attributes, 0, new Set());
    const readable = new Map<string, string>();
    for (const uid of targets) {
      if (uid === "admin::user" || !strapi.contentTypes[uid as UID.ContentType]) continue;
      if (permissionChecker(strapi, actor.ability, uid).can.read()) readable.set(uid, await labelField(uid));
    }
    return (uid) => readable.get(uid);
  }

  async function prepare(user: AgentUser, uid: string) {
    const actor = await loadActor(strapi, user);
    const model = contentType(uid);
    return { actor, model, pc: permissionChecker(strapi, actor.ability, uid) };
  }

  const localeOf = (model: Model, locale: string | undefined) => (isLocalized(model) ? locale : undefined);

  /**
   * What to load with an entry, limited to what the person may see: fields their role can read,
   * and labels of related entries only from types they can read. (The Content Manager's query
   * sanitizer checks nested `fields` against the parent type, so populate is built here instead;
   * sanitizeOutput still filters what comes back.)
   */
  async function readPopulate(actor: Actor, model: Model, pc: PermissionChecker, toMany: boolean, depth: number) {
    const populate = buildPopulate(model, getModel, { depth, toMany, labelOf: await relationLabels(actor, model) });
    const readable = Object.fromEntries(Object.entries(populate).filter(([field]) => pc.can.read(undefined, field)));
    // Role conditions are checked against the entry, so load what they look at too.
    return { ...((await conditionPopulate(pc, model.uid, "read")) as object), ...readable };
  }

  /** Relations a role condition may look at (e.g. createdBy for "is creator"), as the Content Manager loads them. */
  async function conditionPopulate(pc: PermissionChecker, uid: string, action: "read" | "update" | "delete" | "publish", locale?: string) {
    const permissionQuery = await pc.sanitizedQuery[action]({ locale });
    const builder = cm().service("populate-builder") as unknown as (uid: string) => { populateFromQuery(query: unknown): { build(): Promise<unknown> } };
    return builder(uid).populateFromQuery(permissionQuery).build();
  }

  /**
   * An entry's label for an approval card, only when the person may read that entry: the read
   * query carries the role's conditions, so entries they can't see stay unnamed.
   */
  async function readableLabel(user: AgentUser, model: Model, documentId: string | undefined, locale: string | undefined): Promise<string | undefined> {
    // Without a documentId only a single type's one entry is meant; anything else would name the wrong one.
    if (!documentId && !isSingleType(model)) return undefined;
    try {
      const actor = await loadActor(strapi, user);
      const pc = permissionChecker(strapi, actor.ability, model.uid);
      const label = await labelField(model.uid);
      if (label === "documentId" || pc.cannot.read(undefined, label)) return undefined;
      const query = await pc.sanitizedQuery.read(documentId ? { filters: { documentId } } : {});
      const entry = (await documents(model.uid).findFirst({
        ...query,
        locale: localeOf(model, locale),
        status: hasDraftAndPublish(model) ? "draft" : undefined,
        populate: await conditionPopulate(pc, model.uid, "read"),
      })) as Entry | null;
      return entry && pc.can.read(entry) && typeof entry[label] === "string" ? entry[label] : undefined;
    } catch {
      // The card falls back to the documentId; execute reports any real problem.
      return undefined;
    }
  }

  /** The draft (or only) version of an entry, or of the single type's entry. */
  async function findVersion(model: Model, documentId: string | undefined, locale: string | undefined, populate: unknown) {
    const status = hasDraftAndPublish(model) ? "draft" : undefined;
    if (!documentId) {
      if (!isSingleType(model)) throw new ContentToolError(`${model.info.displayName} is a collection type: pass the entry's documentId.`);
      return (await documents(model.uid).findFirst({ locale, status, populate })) as Entry | null;
    }
    return (await documents(model.uid).findOne({ documentId, locale, status, populate })) as Entry | null;
  }

  /** draft, published or modified (published with newer draft changes), as the Content Manager shows it. */
  async function withStatus(model: Model, entries: Entry[]): Promise<Entry[]> {
    if (!hasDraftAndPublish(model) || !entries.length) return entries;
    const metadata = cm().service("document-metadata");
    const available = (await metadata.getManyAvailableStatus(model.uid, entries)) as Entry[];
    return entries.map((entry) => {
      const versions = available.filter((v) => v.documentId === entry.documentId && (!entry.locale || v.locale === entry.locale));
      return { ...entry, status: metadata.getStatus(entry, versions) };
    });
  }

  const openAction = (model: Model, entry: Entry, locale?: string): UiAction => ({
    label: `Open in Content Manager`,
    kind: "event",
    event: OPEN_ENTRY_EVENT,
    payload: { contentType: model.uid, kind: model.kind, documentId: entry.documentId, locale: entry.locale ?? locale },
  });

  const entryName = (model: Model, entry: Entry | null | undefined, label: string) =>
    entry && typeof entry[label] === "string" && entry[label] ? `"${entry[label]}"` : entry?.documentId ? `(${entry.documentId})` : "";

  /** Wraps a tool body: Strapi's errors become a result the model can read and act on. */
  async function guarded(run: () => Promise<ToolOutput>): Promise<ToolOutput> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ContentToolError)) strapi.log.warn(`[klymbak] content tool failed: ${describeError(error)}`);
      return { text: describeError(error), isError: true };
    }
  }

  function changeSummary(model: Model, data: Entry | undefined): string {
    const editable = new Set(editableAttributes(model).map(([name]) => name));
    const fields = Object.keys(data ?? {}).filter((key) => editable.has(key));
    return fields.length ? `Fields: ${fields.join(", ")}` : "No fields given.";
  }

  function notes(ignored: string[], denied: string[]): string[] {
    return [
      ignored.length ? `Ignored: ${ignored.join(", ")}.` : "",
      denied.length ? `Not changed, because your role can't edit them: ${denied.join(", ")}.` : "",
    ].filter(Boolean);
  }

  // -------------------------------------------------------------------------

  const listContentTypes = defineTool({
    name: "list_content_types",
    label: "List content types",
    description:
      "Lists the content types you can read in this Strapi project, with their UID, kind, fields and what your role may do with them. Call it first to learn the content model.",
    readOnly: true,
    parameters: Type.Object({}),
    execute: (_args, ctx) =>
      guarded(async () => {
        const actor = await loadActor(strapi, ctx.user);
        const rows = [];
        for (const { model, may } of readableContentTypes(strapi, actor)) {
          rows.push({
            uid: model.uid,
            name: model.info.displayName,
            kind: isSingleType(model) ? "single" : "collection",
            draftAndPublish: hasDraftAndPublish(model),
            localized: isLocalized(model),
            mainField: await labelField(model.uid),
            fields: editableAttributes(model).map(([name]) => name),
            youCan: ["read", ...may],
          });
        }
        if (!rows.length) return "Your role can't read any content types.";
        return {
          text: JSON.stringify(rows),
          ui: ui.table({
            title: "Content types",
            columns: [
              { key: "name", label: "Name" },
              { key: "uid", label: "UID", format: "code" },
              { key: "kind", label: "Kind", format: "badge" },
              { key: "permissions", label: "You can" },
            ],
            rows: rows.map((row) => ({ ...row, permissions: row.youCan.join(", ") })),
          }),
        };
      }),
  });

  const describeContentType = defineTool({
    name: "describe_content_type",
    label: "Describe content type",
    description:
      "Shows a content type's fields: types, required ones, enum values, relation targets and component fields. Call it before you create or update entries of that type.",
    readOnly: true,
    parameters: Type.Object({ contentType: contentTypeParam }),
    execute: ({ contentType: uid }, ctx) =>
      guarded(async () => {
        const { model, pc } = await prepare(ctx.user, uid);
        if (pc.cannot.read()) throw forbidden(`read ${model.info.displayName}`);
        const locked = editableAttributes(model)
          .map(([name]) => name)
          .filter((field) => pc.can.update() && pc.cannot.update(undefined, field));
        const may = (["create", "update", "delete", "publish"] as const).filter((action) => pc.can[action]());
        const lines = [
          describeModel(model, getModel),
          "",
          `Label field: ${await labelField(uid)}.`,
          `Your role may: read${may.length ? `, ${may.join(", ")}` : " only"}.`,
          locked.length ? `Fields your role can't change: ${locked.join(", ")}.` : "",
        ];
        return lines.filter(Boolean).join("\n");
      }),
  });

  const findEntries = defineTool({
    name: "find_entries",
    label: "Find entries",
    description:
      'Lists entries of a collection type with Strapi filters, sorting and paging. Filters use Strapi syntax on fields, e.g. { "title": { "$containsi": "pizza" } }, { "category": { "name": { "$eq": "news" } } } or { "$or": [...] }. Operators: $eq $ne $lt $lte $gt $gte $in $notIn $contains $containsi $startsWith $endsWith $null $notNull $between. Long text, rich text and components are left out unless you name them in `fields`; use get_entry for one entry in full. With Draft & Publish each result has a status: draft (never published), published, or modified (live, with newer unpublished changes in the draft).',
    readOnly: true,
    parameters: Type.Object({
      contentType: contentTypeParam,
      filters: Type.Optional(anyObject("Strapi filters object.")),
      sort: Type.Optional(Type.Array(Type.String(), { description: 'e.g. ["updatedAt:desc"] or ["title:asc"]. Default newest first.' })),
      fields: Type.Optional(Type.Array(Type.String(), { description: "Scalar fields to return. Default: the short ones." })),
      status: Type.Optional(StringEnum(["draft", "published"], { description: "Draft & Publish types: draft (default, the latest version) or published (what is live)." })),
      locale: localeParam,
      page: Type.Optional(Type.Integer({ minimum: 1, description: "Default 1." })),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE, description: "Default 20, at most 100." })),
    }),
    execute: (args, ctx) =>
      guarded(async () => {
        const { actor, model, pc } = await prepare(ctx.user, args.contentType);
        if (pc.cannot.read()) throw forbidden(`read ${model.info.displayName}`);
        const label = await labelField(model.uid);
        const attributes = new Map(editableAttributes(model));
        const isScalar = (a: Attribute) => a.type !== "relation" && a.type !== "media" && a.type !== "component" && a.type !== "dynamiczone";
        const requested = args.fields?.length ? args.fields : [...attributes].filter(([, a]) => isScalar(a) && !HEAVY_TYPES.has(a.type)).map(([name]) => name);
        // Models often name relations, components or the computed status in `fields`, which
        // Strapi's fields parameter rejects: load those through populate, and report unknown names.
        const fields = requested.filter((name) => attributes.get(name) && isScalar(attributes.get(name)!));
        const structured = requested.filter((name) => attributes.get(name) && !isScalar(attributes.get(name)!));
        const unknown = requested.filter((name) => !attributes.has(name) && !["status", "documentId", "id", "updatedAt", "createdAt", "publishedAt", "locale"].includes(name));
        const full = structured.length ? await readPopulate(actor, model, pc, true, DEPTH) : {};
        const populate = { ...(await readPopulate(actor, model, pc, false, 0)), ...Object.fromEntries(structured.filter((name) => name in full).map((name) => [name, full[name]])) };
        // Applies the role's conditions to the filters and drops fields it can't read.
        // Status and locale detection need the timestamps and locale of each version.
        const system = ["updatedAt", "publishedAt", ...(isLocalized(model) ? ["locale"] : [])];
        const query = await pc.sanitizedQuery.read({
          filters: args.filters,
          sort: args.sort?.length ? args.sort : ["updatedAt:desc"],
          fields: [...new Set([...fields, label, ...system].filter((f) => f !== "documentId"))],
        });
        const page = args.page ?? 1;
        const pageSize = Math.min(args.pageSize ?? 20, MAX_PAGE_SIZE);
        const params = { locale: localeOf(model, args.locale), status: hasDraftAndPublish(model) ? (args.status ?? "draft") : undefined };
        const [found, total] = await Promise.all([
          documents(model.uid).findMany({ ...query, populate, ...params, start: (page - 1) * pageSize, limit: pageSize }),
          documents(model.uid).count({ filters: query.filters, ...params }),
        ]);
        const sanitized = await Promise.all((found as Entry[]).map((entry) => pc.sanitizeOutput(entry)));
        const results = (await withStatus(model, sanitized)).map((entry) => shapeEntry(model, entry, getModel));

        const text = JSON.stringify({ contentType: model.uid, page, pageSize, total, results, ...(unknown.length ? { unknownFields: unknown } : {}) });
        if (!results.length) return { text, ui: ui.alert("info", `No ${model.info.pluralName ?? "entries"} match.`) };
        return { text, ui: entriesTable(model, results, label, total, args.locale) };
      }),
  });

  function entriesTable(model: Model, results: Entry[], label: string, total: number, locale?: string) {
    const columns: TableColumn[] = [{ key: label, label: humanize(label) }];
    if (hasDraftAndPublish(model)) {
      columns.push({ key: "status", label: "Status", format: "badge", tones: { published: "success", modified: "info", draft: "neutral" } });
    }
    const present = new Set(results.flatMap((entry) => Object.keys(entry)));
    const extra = editableAttributes(model).filter(
      ([name, a]) => name !== label && present.has(name) && (COLUMN_TYPES.has(a.type) || (a.type === "relation" && a.target !== "admin::user")),
    );
    for (const [name, attribute] of extra.slice(0, 4)) {
      columns.push({ key: name, label: humanize(name), format: attribute.type === "date" ? "date" : attribute.type === "datetime" ? "datetime" : undefined });
    }
    columns.push({ key: "updatedAt", label: "Updated", format: "relative" });
    const rows = results.map((entry) => {
      const row: Entry = { ...entry, contentType: model.uid, kind: model.kind, locale: entry.locale ?? locale };
      for (const [name, attribute] of extra) {
        if (attribute.type !== "relation") continue;
        const value = entry[name];
        const target = attribute.target ? labels.get(attribute.target) : undefined;
        row[name] = Array.isArray(value) ? value.map((v) => (target && v?.[target]) ?? v?.documentId).join(", ") : value ? ((target && value[target]) ?? value.documentId) : "";
      }
      return row;
    });
    return ui.table({
      title: model.info.displayName,
      columns,
      rows,
      totalRows: total,
      rowKey: "documentId",
      rowActions: [{ label: "Open", kind: "event", event: OPEN_ENTRY_EVENT }],
    });
  }

  const getEntry = defineTool({
    name: "get_entry",
    label: "Get entry",
    description:
      "Reads one entry in full: every field you may see, components and dynamic zones, rich text as Markdown and related entries by documentId and label. For single types, leave out documentId.",
    readOnly: true,
    parameters: Type.Object({
      contentType: contentTypeParam,
      documentId: documentIdParam,
      status: Type.Optional(StringEnum(["draft", "published"], { description: "Draft & Publish types: draft (default) or published." })),
      locale: localeParam,
    }),
    execute: (args, ctx) =>
      guarded(async () => {
        const { actor, model, pc } = await prepare(ctx.user, args.contentType);
        if (pc.cannot.read()) throw forbidden(`read ${model.info.displayName}`);
        if (!args.documentId && !isSingleType(model)) throw new ContentToolError("Pass the entry's documentId (find_entries lists them).");
        const populate = await readPopulate(actor, model, pc, true, DEPTH);
        const locale = localeOf(model, args.locale);
        const status = hasDraftAndPublish(model) ? (args.status ?? "draft") : undefined;
        const entry = (args.documentId
          ? await documents(model.uid).findOne({ documentId: args.documentId, locale, status, populate })
          : await documents(model.uid).findFirst({ locale, status, populate })) as Entry | null;
        if (!entry) {
          return `No ${status ? `${status} ` : ""}${locale ? `"${locale}" ` : ""}version of this ${model.info.displayName} exists.`;
        }
        if (pc.cannot.read(entry)) throw forbidden(`read this ${model.info.displayName}`);
        const [withMeta] = await withStatus(model, [await pc.sanitizeOutput(entry)]);
        const shaped = shapeEntry(model, withMeta, getModel);
        const label = await labelField(model.uid);
        const media = autoMedia(entryMedia(model, shaped, getModel));
        return {
          text: JSON.stringify({ contentType: model.uid, entry: shaped }),
          ui: [
            ui.keyValue(summaryItems(model, shaped), `${model.info.displayName} ${entryName(model, shaped, label)}`.trim()),
            ...(media ? [media] : []),
            ui.actions([openAction(model, shaped, locale)]),
          ],
        };
      }),
  });

  function summaryItems(model: Model, entry: Entry) {
    const items: { label: string; value: unknown; format?: "badge" | "relative" | "datetime" }[] = [];
    if (entry.status) items.push({ label: "Status", value: entry.status, format: "badge" });
    for (const [name, attribute] of editableAttributes(model)) {
      const value = entry[name];
      if (value === undefined || value === null || value === "") continue;
      if (attribute.type === "relation") {
        const target = attribute.target ? labels.get(attribute.target) : undefined;
        const names = (Array.isArray(value) ? value : [value]).map((v: Entry) => (target && v?.[target]) ?? v?.documentId);
        items.push({ label: humanize(name), value: names.join(", ") || "None" });
      } else if (attribute.type === "media") {
        items.push({ label: humanize(name), value: (Array.isArray(value) ? value : [value]).map((v: Entry) => v?.name).join(", ") });
      } else if (attribute.type === "component" || attribute.type === "dynamiczone") {
        items.push({ label: humanize(name), value: Array.isArray(value) ? `${value.length} item${value.length === 1 ? "" : "s"}` : "Set" });
      } else {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        items.push({ label: humanize(name), value: text.length > 280 ? `${text.slice(0, 280)}…` : text });
      }
    }
    if (entry.updatedAt) items.push({ label: "Updated", value: entry.updatedAt, format: "relative" });
    return items;
  }

  // Writes ------------------------------------------------------------------

  const createEntry = defineTool({
    name: "create_entry",
    label: "Create entry",
    description:
      "Creates an entry. For Draft & Publish types it is created as a draft; it is not published. Give field values in `data` as described by describe_content_type: rich text as Markdown (Media Library images as ![alt](url)), media fields as file ids, relations as documentIds, components as objects, dynamic zones as a list of { __component, ...fields }. Leave out what you don't know rather than inventing it.",
    parameters: Type.Object({
      contentType: contentTypeParam,
      data: anyObject("Field values."),
      locale: localeParam,
    }),
    approval: async (args) => {
      const model = getModel(args.contentType);
      const label = model ? await labelField(model.uid) : "title";
      const data = args.data as Entry | undefined;
      const name = typeof data?.[label] === "string" ? ` "${data[label]}"` : "";
      return { title: `Create ${model?.info.displayName ?? "entry"}${name}`, description: changeSummary(model ?? ({ attributes: {} } as Model), args.data), risk: "low" };
    },
    execute: (args, ctx) =>
      guarded(async () => {
        const { actor, model, pc } = await prepare(ctx.user, args.contentType);
        if (pc.cannot.create()) throw forbidden(`create ${model.info.displayName} entries`);
        const locale = localeOf(model, args.locale);
        if (isSingleType(model) && (await findVersion(model, undefined, locale, {}))) {
          throw new ContentToolError(`${model.info.displayName} is a single type and already has its entry: use update_entry.`);
        }
        const { data, ignored } = normalizeInput(model, args.data, getModel, await imageLookup(strapi, actor, args.data));
        const sanitized = await pc.sanitizeCreateInput(data);
        const denied = removedFields(data, sanitized);
        const created = (await documents(model.uid).create({
          data: { ...sanitized, createdBy: actor.admin.id, updatedBy: actor.admin.id },
          locale,
          populate: await readPopulate(actor, model, pc, false, 0),
        })) as Entry;
        const shaped = shapeEntry(model, await pc.sanitizeOutput(created), getModel);
        const label = await labelField(model.uid);
        const draft = hasDraftAndPublish(model) ? " as a draft (not published)" : "";
        return {
          text: [`Created ${model.info.displayName} ${created.documentId}${draft}.`, ...notes(ignored, denied), JSON.stringify(shaped)].join("\n"),
          ui: [
            ui.alert("success", `${model.info.displayName} ${entryName(model, shaped, label)} created${draft}.`),
            ui.actions([openAction(model, shaped, locale)]),
          ],
        };
      }),
  });

  const updateEntry = defineTool({
    name: "update_entry",
    label: "Update entry",
    description:
      "Changes fields of an entry (only the fields you pass; the rest stay as they are). For Draft & Publish types it changes the draft; publish_entry makes it live. Rich text as Markdown (Media Library images as ![alt](url)), media fields as file ids, relations as documentIds or { connect, disconnect, set }. A component or dynamic zone you pass replaces the whole value, so read the entry first and send it back complete. For single types, leave out documentId. Passing a locale the entry doesn't have yet creates that translation.",
    parameters: Type.Object({
      contentType: contentTypeParam,
      documentId: documentIdParam,
      data: anyObject("Fields to change."),
      locale: localeParam,
    }),
    approval: async (args, ctx) => {
      const model = getModel(args.contentType);
      if (!model) return { title: "Update entry", risk: "medium" };
      const label = await readableLabel(ctx.user, model, args.documentId, args.locale);
      const name = label ? ` "${label}"` : args.documentId ? ` (${args.documentId})` : "";
      return { title: `Update ${model.info.displayName}${name}`, description: changeSummary(model, args.data as Entry), risk: "medium" };
    },
    execute: (args, ctx) =>
      guarded(async () => {
        const { actor, model, pc } = await prepare(ctx.user, args.contentType);
        if (pc.cannot.update() && pc.cannot.create()) throw forbidden(`edit ${model.info.displayName} entries`);
        const locale = localeOf(model, args.locale);
        const current = await findVersion(model, args.documentId, locale, await conditionPopulate(pc, model.uid, "update", locale));
        const documentId = current?.documentId ?? args.documentId;
        if (!current) {
          // A new translation of an existing entry, or the first entry of a single type. Counted
          // across every locale and status, as the Content Manager checks existence.
          const exists = documentId ? await strapi.db.query(model.uid as UID.ContentType).count({ where: { documentId } }) : 0;
          if (documentId && !exists) throw new ContentToolError(`There is no ${model.info.displayName} with documentId ${documentId}.`);
          if (pc.cannot.create()) throw forbidden(`create ${model.info.displayName} entries`);
        } else if (pc.cannot.update(current)) {
          throw forbidden(`update this ${model.info.displayName}`);
        }
        const { data, ignored } = normalizeInput(model, args.data, getModel, await imageLookup(strapi, actor, args.data));
        const sanitized = current ? await pc.sanitizeUpdateInput(current)(data) : await pc.sanitizeCreateInput(data);
        const denied = removedFields(data, sanitized);
        if (!Object.keys(sanitized).length) {
          throw new ContentToolError(["Nothing was changed.", ...notes(ignored, denied)].join(" "));
        }
        const params = { data: { ...sanitized, updatedBy: actor.admin.id }, locale, populate: await readPopulate(actor, model, pc, false, 0) };
        const updated = (documentId
          ? await documents(model.uid).update({ documentId, ...params })
          : await documents(model.uid).create({ ...params, data: { ...params.data, createdBy: actor.admin.id } })) as Entry;
        const shaped = shapeEntry(model, await pc.sanitizeOutput(updated), getModel);
        const label = await labelField(model.uid);
        const draft = hasDraftAndPublish(model) ? " The draft changed; it is not published yet." : "";
        return {
          text: [`Updated ${model.info.displayName} ${updated.documentId}: ${Object.keys(sanitized).join(", ")}.${draft}`, ...notes(ignored, denied), JSON.stringify(shaped)].join("\n"),
          ui: [
            ui.alert("success", `${model.info.displayName} ${entryName(model, shaped, label)} updated: ${Object.keys(sanitized).join(", ")}.${draft}`),
            ui.actions([openAction(model, shaped, locale)]),
          ],
        };
      }),
  });

  /** delete, publish, unpublish and discard: same shape, different Document Service call. */
  function lifecycleTool(options: {
    name: string;
    label: string;
    verb: string;
    description: string;
    risk: "medium" | "high";
    action: "delete" | "publish" | "unpublish" | "discard";
    draftAndPublishOnly: boolean;
    run: (uid: string, documentId: string, locale: string | undefined) => Promise<unknown>;
    done: string;
  }) {
    return defineTool({
      name: options.name,
      label: options.label,
      description: options.description,
      parameters: Type.Object({ contentType: contentTypeParam, documentId: documentIdParam, locale: localeParam }),
      approval: async (args, ctx) => {
        const model = getModel(args.contentType);
        // Nothing to approve when the call can only fail; execute explains why.
        if (model && options.draftAndPublishOnly && !hasDraftAndPublish(model)) return false;
        const label = model ? await readableLabel(ctx.user, model, args.documentId, args.locale === "*" ? undefined : args.locale) : undefined;
        const name = label ? ` "${label}"` : args.documentId ? ` (${args.documentId})` : "";
        const where = args.locale ? ` (${args.locale === "*" ? "all locales" : args.locale})` : "";
        return { title: `${options.verb} ${model?.info.displayName ?? "entry"}${name}${where}`, risk: options.risk };
      },
      execute: (args, ctx) =>
        guarded(async () => {
          const { model, pc } = await prepare(ctx.user, args.contentType);
          if (options.draftAndPublishOnly && !hasDraftAndPublish(model)) {
            throw new ContentToolError(`${model.info.displayName} has no Draft & Publish: changes are live already.`);
          }
          if (pc.cannot[options.action]()) throw forbidden(`${options.verb.toLowerCase()} ${model.info.displayName} entries`);
          const locale = isLocalized(model) ? args.locale : undefined;
          const lookupLocale = locale === "*" ? undefined : locale;
          const conditionAction = options.action === "delete" ? "delete" : options.action === "discard" ? "update" : "publish";
          const current = await findVersion(model, args.documentId, lookupLocale, await conditionPopulate(pc, model.uid, conditionAction, lookupLocale));
          if (!current) throw new ContentToolError(`There is no such ${model.info.displayName}${lookupLocale ? ` in "${lookupLocale}"` : ""}.`);
          if (pc.cannot[options.action](current)) throw forbidden(`${options.verb.toLowerCase()} this ${model.info.displayName}`);
          await options.run(model.uid, current.documentId, locale);
          const label = await labelField(model.uid);
          return {
            text: `${model.info.displayName} ${current.documentId} ${options.done}.`,
            ui: ui.alert(options.action === "delete" ? "warning" : "success", `${model.info.displayName} ${entryName(model, current, label)} ${options.done}.`),
          };
        }),
    });
  }

  const deleteEntry = lifecycleTool({
    name: "delete_entry",
    label: "Delete entry",
    verb: "Delete",
    description:
      'Deletes an entry for good, draft and published versions alike. For localized types it deletes one locale (the default unless you pass `locale`); pass locale "*" for every locale. Only when the person clearly asked for it.',
    risk: "high",
    action: "delete",
    draftAndPublishOnly: false,
    run: (uid, documentId, locale) => documents(uid).delete({ documentId, locale }),
    done: "deleted",
  });

  const publishEntry = lifecycleTool({
    name: "publish_entry",
    label: "Publish entry",
    verb: "Publish",
    description: "Publishes the current draft of an entry, making it live on the site. Only when the person asked for it. Strapi checks required fields here.",
    risk: "medium",
    action: "publish",
    draftAndPublishOnly: true,
    run: (uid, documentId, locale) => documents(uid).publish({ documentId, locale }),
    done: "published",
  });

  const unpublishEntry = lifecycleTool({
    name: "unpublish_entry",
    label: "Unpublish entry",
    verb: "Unpublish",
    description: "Takes an entry off the site. The draft stays, so it can be published again.",
    risk: "medium",
    action: "unpublish",
    draftAndPublishOnly: true,
    run: (uid, documentId, locale) => documents(uid).unpublish({ documentId, locale }),
    done: "unpublished",
  });

  const discardDraft = lifecycleTool({
    name: "discard_draft",
    label: "Discard draft",
    verb: "Discard draft of",
    description: "Throws away unpublished changes, resetting the draft to the published version.",
    risk: "medium",
    action: "discard",
    draftAndPublishOnly: true,
    run: (uid, documentId, locale) => documents(uid).discardDraft({ documentId, locale }),
    done: "draft discarded",
  });

  return [listContentTypes, describeContentType, findEntries, getEntry, createEntry, updateEntry, deleteEntry, publishEntry, unpublishEntry, discardDraft, uploadMediaTool(strapi)];
}

function humanize(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
