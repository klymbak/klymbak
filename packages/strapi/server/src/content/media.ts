import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { autoMedia, defineTool, Type, ui, type HookContext, type ImagePart, type ToolDefinition } from "@klymbak/server";
import type { Core } from "@strapi/strapi";
import { ContentToolError, describeError, forbidden, loadActor, type Actor } from "./access.ts";
import type { BlockImage, ImageLookup } from "./blocks.ts";

const FILE_UID = "plugin::upload.file";
const UPLOAD = { create: "plugin::upload.assets.create", read: "plugin::upload.read" };

/**
 * Raster images only, recognised by their first bytes rather than the type the browser declared.
 * SVG is left out: it can carry scripts.
 */
const IMAGE_TYPES: { mime: string; ext: string; matches: (bytes: Buffer) => boolean }[] = [
  { mime: "image/png", ext: ".png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ".jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: ".gif", matches: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  { mime: "image/webp", ext: ".webp", matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** A Media Library file as Strapi stores it. */
export type MediaFile = Record<string, unknown> & { id: number; url: string; name: string; mime: string };

const matchesPattern = (mime: string, patterns: string[]) =>
  patterns.some((pattern) => new RegExp(`^${pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(mime));

function permissions(strapi: Core.Strapi, actor: Actor, action: string) {
  return strapi.service("admin::permission").createPermissionsManager({ ability: actor.ability, action, model: FILE_UID }) as {
    isAllowed: boolean;
    sanitizeOutput(data: unknown, options: { action: string }): Promise<MediaFile>;
  };
}

/** Images the person attached in this conversation, oldest first. */
async function attachedImages(ctx: HookContext): Promise<ImagePart[]> {
  const session = await ctx.runtime.getSession(ctx.user, ctx.sessionId);
  return session.messages.filter((message) => message.role === "user").flatMap((message) => message.parts.filter((part): part is ImagePart => part.type === "image"));
}

function pickImage(images: ImagePart[], index: number | undefined): ImagePart {
  if (!images.length) throw new ContentToolError("No image was attached in this conversation. Ask the person to attach or paste the image, then try again.");
  const image = index === undefined ? images.at(-1) : images[index - 1];
  if (!image) throw new ContentToolError(`There ${images.length === 1 ? "is 1 image" : `are ${images.length} images`} in this conversation; pick one from 1 to ${images.length}.`);
  return image;
}

const fileName = (name: string | undefined, fallback: string) =>
  (name ?? fallback)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .trim()
    .slice(0, 120) || fallback;

/** upload_media: puts an image the person attached into the Media Library, as them. */
export function uploadMediaTool(strapi: Core.Strapi): ToolDefinition<any> {
  return defineTool({
    name: "upload_media",
    label: "Upload to Media Library",
    description:
      'Uploads an image the person attached in this conversation (PNG, JPEG, GIF or WebP) to the Media Library. Returns the file\'s id and URL: set a media field to the id, e.g. { "cover": 12 }, or put the image in a rich-text (Blocks) field as ![alt text](url). Only for images attached here; it can\'t fetch files from links.',
    parameters: Type.Object({
      image: Type.Optional(Type.Integer({ minimum: 1, description: "Which attached image: 1 is the first one in this conversation. Default: the latest." })),
      name: Type.Optional(Type.String({ description: 'File name, e.g. "autumn-mushrooms". Default: "image-<n>".' })),
      alternativeText: Type.Optional(Type.String({ description: "What the image shows, for people using screen readers. Write one if the person didn't." })),
      caption: Type.Optional(Type.String()),
    }),
    approval: async (args, ctx) => {
      const images = await attachedImages(ctx).catch(() => []);
      const index = args.image ?? images.length;
      return {
        title: `Upload ${fileName(args.name, `image-${index || 1}`)} to the Media Library`,
        description: args.alternativeText ? `Alternative text: ${args.alternativeText}` : undefined,
        risk: "low",
      };
    },
    execute: async (args, ctx) => {
      try {
        const actor = await loadActor(strapi, ctx.user);
        const pm = permissions(strapi, actor, UPLOAD.create);
        if (!pm.isAllowed) throw forbidden("upload files to the Media Library");

        const images = await attachedImages(ctx);
        const image = pickImage(images, args.image);
        const bytes = Buffer.from(image.data, "base64");
        const type = IMAGE_TYPES.find((candidate) => candidate.matches(bytes));
        if (!type) throw new ContentToolError("Only PNG, JPEG, GIF and WebP images can be uploaded.");
        // The same allow and deny lists Strapi applies to uploads from the admin panel.
        const security = (strapi.config.get("plugin::upload.security") ?? {}) as { allowedTypes?: string[]; deniedTypes?: string[] };
        if ((security.deniedTypes && matchesPattern(type.mime, security.deniedTypes)) || (Array.isArray(security.allowedTypes) && !matchesPattern(type.mime, security.allowedTypes))) {
          throw new ContentToolError(`This project's upload settings don't allow ${type.mime} files.`);
        }

        const name = fileName(args.name, `image-${args.image ?? images.length}`);
        const dir = await mkdtemp(path.join(tmpdir(), "klymbak-upload-"));
        let uploaded: MediaFile;
        try {
          const filepath = path.join(dir, `${name}${type.ext}`);
          await writeFile(filepath, bytes);
          const [file] = (await strapi.plugin("upload").service("upload").upload(
            {
              data: { fileInfo: { name: `${name}${type.ext}`, alternativeText: args.alternativeText ?? null, caption: args.caption ?? null } },
              files: { filepath, originalFilename: `${name}${type.ext}`, mimetype: type.mime, size: bytes.length },
            },
            { user: actor.admin },
          )) as MediaFile[];
          uploaded = file!;
        } finally {
          await rm(dir, { recursive: true, force: true });
        }

        const signed = await strapi.plugin("upload").service("file").signFileUrls(uploaded);
        const file = await pm.sanitizeOutput(signed, { action: UPLOAD.read });
        const size = file.width && file.height ? `, ${file.width}×${file.height}` : "";
        const media = autoMedia([file]);
        return {
          text: [
            `Uploaded ${file.name} to the Media Library: file id ${file.id}, URL ${file.url}${size}.`,
            `Set a media field to ${file.id}, or put it in rich text as ![${args.alternativeText ?? ""}](${file.url}).`,
          ].join(" "),
          ui: [ui.alert("success", `${file.name} uploaded to the Media Library.`), ...(media ? [media] : [])],
        };
      } catch (error) {
        if (!(error instanceof ContentToolError)) strapi.log.warn(`[klymbak] upload failed: ${describeError(error)}`);
        return { text: describeError(error), isError: true };
      }
    },
  });
}

/** Markdown images, ![alt](url), anywhere in model-written input. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** What a Blocks image node keeps of the file, as the Blocks editor stores it. */
const BLOCK_IMAGE_FIELDS = ["name", "alternativeText", "caption", "url", "width", "height", "formats", "hash", "ext", "mime", "size", "previewUrl", "provider", "provider_metadata", "createdAt", "updatedAt"];

/**
 * Finds the Media Library images that Markdown images in `input` point at, by the file's URL exactly
 * as Strapi stores it (what get_entry and upload_media show). Rich-text fields turn those into image
 * blocks; other images stay links. Finds none when the person may not use the Media Library.
 */
export async function imageLookup(strapi: Core.Strapi, actor: Actor, input: unknown): Promise<ImageLookup> {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") for (const match of value.matchAll(MARKDOWN_IMAGE)) urls.add(match[1]!);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(input);
  if (!urls.size || !permissions(strapi, actor, UPLOAD.read).isAllowed) return () => undefined;
  const files = (await strapi.db.query(FILE_UID).findMany({ where: { url: { $in: [...urls] } } })) as MediaFile[];
  const images = new Map(files.filter((file) => file.mime?.startsWith("image/")).map((file) => [file.url, file]));
  return (url) => {
    const file = images.get(url);
    return file ? (Object.fromEntries(BLOCK_IMAGE_FIELDS.filter((key) => key in file).map((key) => [key, file[key]])) as BlockImage) : undefined;
  };
}
