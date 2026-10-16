import { blocksToMarkdown, isBlocks, markdownToBlocks } from "./blocks.ts";
import { SYSTEM_FIELDS, editableAttributes, type Attribute, type GetModel, type Model } from "./model.ts";

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Entry => typeof value === "object" && value !== null && !Array.isArray(value);

/** Drops database ids, which the model must not use: entries are addressed by documentId. */
function withoutIds(value: Entry): Entry {
  const { id: _id, ...rest } = value;
  return rest;
}

function shapeValue(attribute: Attribute, value: unknown, getModel: GetModel): unknown {
  if (value === null || value === undefined) return value;
  switch (attribute.type) {
    case "blocks":
      return isBlocks(value) ? blocksToMarkdown(value) : value;
    case "relation":
    case "media":
      return Array.isArray(value) ? value.map((v) => (isRecord(v) ? withoutIds(v) : v)) : isRecord(value) ? withoutIds(value) : value;
    case "component": {
      const component = attribute.component ? getModel(attribute.component) : undefined;
      if (!component) return value;
      return Array.isArray(value) ? value.map((v) => shapeEntry(component, v, getModel)) : shapeEntry(component, value, getModel);
    }
    case "dynamiczone":
      return Array.isArray(value)
        ? value.map((item) => {
            const component = isRecord(item) && typeof item.__component === "string" ? getModel(item.__component) : undefined;
            return component ? { __component: item.__component, ...shapeEntry(component, item, getModel) } : item;
          })
        : value;
    default:
      return value;
  }
}

/**
 * What the model reads for an entry: no database ids, rich text as Markdown, relations as
 * `{ documentId, <label> }`. Run it after Strapi's permission sanitizer.
 */
export function shapeEntry(model: Model, entry: unknown, getModel: GetModel): Entry {
  if (!isRecord(entry)) return {};
  const shaped: Entry = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "id" || key === "__component" || key === "localizations" || key === "createdBy" || key === "updatedBy") continue;
    // A draft's empty publishedAt and a non-localized entry's empty locale say nothing.
    if ((key === "publishedAt" || key === "locale") && value === null) continue;
    const attribute = model.attributes[key];
    shaped[key] = attribute ? shapeValue(attribute, value, getModel) : value;
  }
  return shaped;
}

/** The media files a shaped entry shows, its components and dynamic zones included, in field order. */
export function entryMedia(model: Model, entry: Entry, getModel: GetModel): Entry[] {
  const files: Entry[] = [];
  for (const [name, attribute] of Object.entries(model.attributes)) {
    const values = (Array.isArray(entry[name]) ? entry[name] : [entry[name]]) as unknown[];
    for (const value of values.filter(isRecord)) {
      if (attribute.type === "media") files.push(value);
      const uid = attribute.type === "component" ? attribute.component : attribute.type === "dynamiczone" ? value.__component : undefined;
      const component = typeof uid === "string" ? getModel(uid) : undefined;
      if (component) files.push(...entryMedia(component, value, getModel));
    }
  }
  return files;
}

export interface NormalizedInput {
  data: Entry;
  /** Fields that were left out, with the reason. */
  ignored: string[];
}

function normalizeValue(attribute: Attribute, value: unknown, getModel: GetModel, path: string, ignored: string[]): unknown {
  if (value === null || value === undefined) return value;
  switch (attribute.type) {
    case "blocks":
      return typeof value === "string" ? markdownToBlocks(value) : value;
    case "component": {
      const component = attribute.component ? getModel(attribute.component) : undefined;
      if (!component) return value;
      const each = (item: unknown, index?: number) =>
        isRecord(item) ? normalizeFields(component, item, getModel, index === undefined ? `${path}.` : `${path}[${index}].`, ignored) : item;
      return Array.isArray(value) ? value.map(each) : each(value);
    }
    case "dynamiczone":
      return Array.isArray(value)
        ? value.map((item, index) => {
            const uid = isRecord(item) ? item.__component : undefined;
            const component = typeof uid === "string" ? getModel(uid) : undefined;
            if (!component || !isRecord(item)) return item;
            return { __component: uid, ...normalizeFields(component, item, getModel, `${path}[${index}].`, ignored) };
          })
        : value;
    default:
      return value;
  }
}

function normalizeFields(model: Model, input: Entry, getModel: GetModel, prefix: string, ignored: string[]): Entry {
  const editable = new Map(editableAttributes(model));
  const data: Entry = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "__component") continue;
    const attribute = editable.get(key);
    if (!attribute) {
      ignored.push(`${prefix}${key} (${SYSTEM_FIELDS.has(key) ? "set by Strapi" : "no such field"})`);
      continue;
    }
    data[key] = normalizeValue(attribute, value, getModel, `${prefix}${key}`, ignored);
  }
  return data;
}

/**
 * Prepares model-written data for Strapi: Markdown becomes Blocks for rich-text fields, and
 * fields that don't exist or that Strapi manages are dropped and reported.
 */
export function normalizeInput(model: Model, input: unknown, getModel: GetModel): NormalizedInput {
  const ignored: string[] = [];
  if (!isRecord(input)) return { data: {}, ignored };
  return { data: normalizeFields(model, input, getModel, "", ignored), ignored };
}

/** Top-level fields present in `before` but missing from `after`: what a sanitizer removed. */
export function removedFields(before: Entry, after: Entry): string[] {
  return Object.keys(before).filter((key) => !(key in after));
}
