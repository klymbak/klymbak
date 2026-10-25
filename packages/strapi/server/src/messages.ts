import { createTranslator } from "@klymbak/server";
import de from "./locales/de.ts";
import es from "./locales/es.ts";
import fr from "./locales/fr.ts";
import it from "./locales/it.ts";
import ja from "./locales/ja.ts";
import ko from "./locales/ko.ts";
import nl from "./locales/nl.ts";
import pl from "./locales/pl.ts";
import ptBR from "./locales/pt-BR.ts";
import tr from "./locales/tr.ts";
import uk from "./locales/uk.ts";
import zhHans from "./locales/zh-Hans.ts";

/**
 * What the plugin's tools write for people, in English: labels, approval titles, tables and alerts. The other
 * languages in `locales/` use the same keys. What the model reads (descriptions, results) stays in English.
 */
export const en = {
  "tool.listContentTypes.label": "List content types",
  "tool.listContentTypes.summary": "Lists the content types you can read and what your role may do with them.",
  "tool.describeContentType.label": "Describe content type",
  "tool.describeContentType.summary": "Shows a content type's fields before entries are created or changed.",
  "tool.findEntries.label": "Find entries",
  "tool.findEntries.summary": "Finds entries with filters, sorting and paging.",
  "tool.getEntry.label": "Get entry",
  "tool.getEntry.summary": "Reads one entry in full.",
  "tool.createEntry.label": "Create entry",
  "tool.createEntry.summary": "Creates an entry, as a draft when the type has Draft & Publish.",
  "tool.updateEntry.label": "Update entry",
  "tool.updateEntry.summary": "Changes fields of an entry, or of its draft with Draft & Publish.",
  "tool.deleteEntry.label": "Delete entry",
  "tool.deleteEntry.summary": "Deletes an entry for good.",
  "tool.publishEntry.label": "Publish entry",
  "tool.publishEntry.summary": "Publishes an entry's draft, making it live.",
  "tool.unpublishEntry.label": "Unpublish entry",
  "tool.unpublishEntry.summary": "Takes an entry off the site and keeps its draft.",
  "tool.discardDraft.label": "Discard draft",
  "tool.discardDraft.summary": "Throws away an entry's unpublished changes.",
  "tool.uploadMedia.label": "Upload to Media Library",
  "tool.uploadMedia.summary": "Puts an image attached in the chat into the Media Library.",
  "tool.searchDocs.label": "Search Strapi docs",
  "tool.searchDocs.summary": "Searches the Strapi documentation for how something works.",
  "tool.readDocs.label": "Read Strapi docs",
  "tool.readDocs.summary": "Reads a page of the Strapi documentation.",

  "entry.named": '{type} "{name}"',
  "entry.id": "{type} ({id})",
  "entry.unknown": "entry",

  "approval.create": "Create {entry}",
  "approval.update": "Update {entry}",
  "approval.delete": "Delete {entry}",
  "approval.publish": "Publish {entry}",
  "approval.unpublish": "Unpublish {entry}",
  "approval.discard": "Discard draft of {entry}",
  "approval.inLocale": "{title} ({locale})",
  "approval.allLocales": "all locales",
  "approval.fields": "Fields: {fields}",
  "approval.noFields": "No fields given.",
  "approval.upload": "Upload {file} to the Media Library",
  "approval.altText": "Alternative text: {text}",

  "alert.created": "{entry} created.",
  "alert.createdDraft": "{entry} created as a draft (not published).",
  "alert.updated": "{entry} updated: {fields}.",
  "alert.updatedDraft": "{entry} updated: {fields}. The draft changed; it is not published yet.",
  "alert.deleted": "{entry} deleted.",
  "alert.published": "{entry} published.",
  "alert.unpublished": "{entry} unpublished.",
  "alert.discarded": "Draft of {entry} discarded.",
  "alert.uploaded": "{file} uploaded to the Media Library.",
  "alert.noEntries": "No {type} entries match.",

  "contentTypes.title": "Content types",
  "contentTypes.name": "Name",
  "contentTypes.uid": "UID",
  "contentTypes.kind": "Kind",
  "contentTypes.youCan": "You can",
  "kind.single": "Single type",
  "kind.collection": "Collection type",
  "can.read": "read",
  "can.create": "create",
  "can.update": "update",
  "can.delete": "delete",
  "can.publish": "publish",

  "field.status": "Status",
  "field.updated": "Updated",
  "status.draft": "Draft",
  "status.published": "Published",
  "status.modified": "Modified",
  "value.none": "None",
  "value.set": "Set",
  "value.items": "{count, plural, one {# item} other {# items}}",

  "action.open": "Open",
  "action.openInContentManager": "Open in Content Manager",
};

export type PluginMessages = Record<keyof typeof en, string>;

/** The plugin's messages in a person's language: `t(ctx.user.locale, id, values)`. */
export const t = createTranslator(en, { de, es, fr, it, ja, ko, nl, pl, "pt-BR": ptBR, tr, uk, "zh-Hans": zhHans });
