/** The parts of Strapi's content-type and component schemas the content tools read. */
export interface Attribute {
  type: string;
  relation?: string;
  target?: string;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  multiple?: boolean;
  required?: boolean;
  unique?: boolean;
  private?: boolean;
  enum?: string[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  targetField?: string;
  allowedTypes?: string[] | null;
  customField?: string;
  pluginOptions?: { i18n?: { localized?: boolean } };
}

export interface Model {
  uid: string;
  modelType?: "contentType" | "component";
  kind?: "collectionType" | "singleType";
  info: { displayName: string; singularName?: string; pluralName?: string; description?: string };
  options?: { draftAndPublish?: boolean };
  pluginOptions?: { i18n?: { localized?: boolean } };
  attributes: Record<string, Attribute>;
}

export type GetModel = (uid: string) => Model | undefined;

/** Fields Strapi manages itself. The tools show some of them but never accept them as input. */
export const SYSTEM_FIELDS = new Set(["id", "documentId", "createdAt", "updatedAt", "publishedAt", "createdBy", "updatedBy", "locale", "localizations"]);

const MANY = new Set(["oneToMany", "manyToMany", "manyWay", "morphToMany", "morphMany"]);
const MAIN_FIELD_NAMES = ["title", "name", "label", "heading", "headline", "subject", "displayName", "username", "email", "slug", "code"];
const TEXT_TYPES = new Set(["string", "text", "email", "uid", "enumeration"]);

export const hasDraftAndPublish = (model: Model) => model.options?.draftAndPublish === true;
export const isLocalized = (model: Model) => model.pluginOptions?.i18n?.localized === true;
export const isSingleType = (model: Model) => model.kind === "singleType";
export const isToMany = (attribute: Attribute) => MANY.has(attribute.relation ?? "");

/** Fields people edit: everything except Strapi's bookkeeping, private fields and admin users. */
export function editableAttributes(model: Model): [string, Attribute][] {
  return Object.entries(model.attributes).filter(
    ([name, attribute]) => !SYSTEM_FIELDS.has(name) && !attribute.private && attribute.target !== "admin::user",
  );
}

/** The field that names an entry in lists and relation pickers, e.g. an article's title. */
export function guessMainField(model: Model): string {
  const attributes = model.attributes;
  const named = MAIN_FIELD_NAMES.find((name) => attributes[name] && TEXT_TYPES.has(attributes[name]!.type));
  if (named) return named;
  const firstText = Object.entries(attributes).find(([name, a]) => !SYSTEM_FIELDS.has(name) && !a.private && (a.type === "string" || a.type === "uid"));
  return firstText?.[0] ?? "documentId";
}

/** One line per field, in words a model can act on. */
export function describeAttribute(name: string, attribute: Attribute): string {
  const notes: string[] = [];
  if (attribute.required) notes.push("required");
  if (attribute.unique) notes.push("unique");
  if (attribute.maxLength) notes.push(`max ${attribute.maxLength} chars`);
  if (attribute.minLength) notes.push(`min ${attribute.minLength} chars`);
  if (attribute.min !== undefined) notes.push(`min ${attribute.min}`);
  if (attribute.max !== undefined) notes.push(`max ${attribute.max}`);
  if (attribute.default !== undefined) notes.push(`default ${JSON.stringify(attribute.default)}`);
  if (attribute.pluginOptions?.i18n?.localized === false) notes.push("same in every locale");
  const suffix = notes.length ? ` (${notes.join(", ")})` : "";

  switch (attribute.type) {
    case "relation":
      return `${name}: relation ${isToMany(attribute) ? "to many" : "to one"} ${attribute.target}${suffix}. Pass documentIds; to-many accepts { connect, disconnect, set }.`;
    case "component":
      return `${name}: ${attribute.repeatable ? "list of" : "one"} ${attribute.component} component${attribute.repeatable ? "s" : ""}${suffix}`;
    case "dynamiczone":
      return `${name}: dynamic zone, a list of blocks, each { "__component": one of ${attribute.components?.join(", ")}, ...its fields }${suffix}`;
    case "media":
      return `${name}: ${attribute.multiple ? "media files" : "media file"} (${attribute.allowedTypes?.join(", ") ?? "any"})${suffix}. Pass Media Library file ids; upload_media uploads an image attached in the chat.`;
    case "enumeration":
      return `${name}: one of ${attribute.enum?.map((v) => JSON.stringify(v)).join(", ")}${suffix}`;
    case "richtext":
      return `${name}: Markdown text${suffix}`;
    case "blocks":
      return `${name}: rich text. Read and write it as Markdown; images must be in the Media Library, written as ![alt](url)${suffix}`;
    case "uid":
      return `${name}: URL slug${attribute.targetField ? ` made from ${attribute.targetField}` : ""}${suffix}. Lowercase letters, digits and dashes.`;
    case "customField":
      return `${name}: custom field ${attribute.customField ?? ""}${suffix}`;
    default:
      return `${name}: ${attribute.type}${suffix}`;
  }
}

/** Describes a content type with every component it uses, for the model. */
export function describeModel(model: Model, getModel: GetModel): string {
  const lines = [
    `${model.info.displayName} (${model.uid}): ${isSingleType(model) ? "single type, one entry" : "collection type"}.`,
    hasDraftAndPublish(model) ? "Draft & Publish: changes go to the draft; publish makes them live." : "No Draft & Publish: changes are live at once.",
    isLocalized(model) ? "Localized: pass `locale` (the default locale is used otherwise)." : undefined,
    model.info.description ? `Description: ${model.info.description}` : undefined,
    "Fields:",
    ...editableAttributes(model).map(([name, attribute]) => `- ${describeAttribute(name, attribute)}`),
  ].filter(Boolean);

  const components = new Map<string, Model>();
  const collect = (attributes: Record<string, Attribute>) => {
    for (const attribute of Object.values(attributes)) {
      for (const uid of attribute.type === "component" ? [attribute.component!] : attribute.type === "dynamiczone" ? (attribute.components ?? []) : []) {
        const component = getModel(uid);
        if (!component || components.has(uid)) continue;
        components.set(uid, component);
        collect(component.attributes);
      }
    }
  };
  collect(model.attributes);
  for (const [uid, component] of components) {
    lines.push("", `Component ${uid} (${component.info.displayName}):`);
    lines.push(...editableAttributes(component).map(([name, attribute]) => `- ${describeAttribute(name, attribute)}`));
  }
  return lines.join("\n");
}

const MEDIA_FIELDS = ["name", "url", "alternativeText", "mime"];

export interface PopulateOptions {
  /** How deep to follow components and dynamic zones. 0 skips them. */
  depth: number;
  /** Load to-many relations too (only their labels). */
  toMany: boolean;
  /** The label field of a related content type, or undefined when the person can't read it. */
  labelOf(uid: string): string | undefined;
}

/**
 * A populate object that loads what a person needs to understand an entry: the label of each
 * related entry (never whole related entries), media names and URLs, and components.
 */
export function buildPopulate(model: Model, getModel: GetModel, options: PopulateOptions): Record<string, unknown> {
  const populate: Record<string, unknown> = {};
  for (const [name, attribute] of editableAttributes(model)) {
    if (attribute.type === "relation") {
      if (!attribute.target || (isToMany(attribute) && !options.toMany)) continue;
      const label = options.labelOf(attribute.target);
      populate[name] = { fields: label && label !== "documentId" ? [label] : ["documentId"] };
    } else if (attribute.type === "media") {
      populate[name] = { fields: MEDIA_FIELDS };
    } else if (attribute.type === "component" && options.depth > 0) {
      const component = getModel(attribute.component!);
      const inner = component ? buildPopulate(component, getModel, { ...options, depth: options.depth - 1 }) : {};
      populate[name] = Object.keys(inner).length ? { populate: inner } : true;
    } else if (attribute.type === "dynamiczone" && options.depth > 0) {
      const on: Record<string, unknown> = {};
      for (const uid of attribute.components ?? []) {
        const component = getModel(uid);
        const inner = component ? buildPopulate(component, getModel, { ...options, depth: options.depth - 1 }) : {};
        on[uid] = Object.keys(inner).length ? { populate: inner } : true;
      }
      populate[name] = { on };
    }
  }
  return populate;
}
