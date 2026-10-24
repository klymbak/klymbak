import {
  requiredVariables,
  templateVariables,
  type McpCompleteRequest,
  type McpPromptInfo,
  type McpResourceInfo,
  type McpResourceTemplateInfo,
  type MessagePart,
  type PromptPart,
  type ResourcePart,
} from "@klymbak/protocol";

/** What the person is typing at the caret: an @ mention of a resource, or a / prompt at the start of the message. */
export interface Mention {
  kind: "resource" | "prompt";
  /** What follows the @ or /. */
  query: string;
  /** Where the @ or / is. */
  start: number;
  /** Where the query ends: the caret. */
  end: number;
}

/**
 * The mention typed just before the caret, if any: an @ at the start or after a space, or a / that starts the
 * message, followed by anything but spaces. "Write to ada@example.com" has none.
 */
export function findMention(text: string, caret: number): Mention | undefined {
  const before = text.slice(0, caret);
  const prompt = /^\/(\S*)$/.exec(before);
  if (prompt) return { kind: "prompt", query: prompt[1]!, start: 0, end: caret };
  const resource = /(^|\s)@([^\s@]*)$/.exec(before);
  if (resource) return { kind: "resource", query: resource[2]!, start: resource.index + resource[1]!.length, end: caret };
  return undefined;
}

/** Resources that match the query, best first: names that start with it, then names with it, then the rest. */
export function matchResources(resources: readonly McpResourceInfo[], query: string, limit = 8): McpResourceInfo[] {
  return rank(resources, query, (r) => [r.name], (r) => [r.uri, r.description, r.server]).slice(0, limit);
}

/** Prompts that match the query, best first, like matchResources. */
export function matchPrompts(prompts: readonly McpPromptInfo[], query: string, limit = 8): McpPromptInfo[] {
  return rank(prompts, query, (p) => [p.name, p.title], (p) => [p.description, p.server]).slice(0, limit);
}

function rank<T>(items: readonly T[], query: string, names: (item: T) => (string | undefined)[], others: (item: T) => (string | undefined)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const has = (texts: (string | undefined)[], test: (text: string) => boolean) => texts.some((text) => text !== undefined && test(text.toLowerCase()));
  return items
    .map((item, index) => {
      const score = has(names(item), (n) => n.startsWith(q)) ? 0 : has(names(item), (n) => n.includes(q)) ? 1 : has(others(item), (o) => o.includes(q)) ? 2 : -1;
      return { item, index, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** An option in the @ or / menu: a resource, a resource template or a prompt, with what to show for it. */
export interface MentionOption {
  key: string;
  name: string;
  detail?: string;
  server: string;
  resource?: McpResourceInfo;
  template?: McpResourceTemplateInfo;
  prompt?: McpPromptInfo;
}

/**
 * The menu for a mention: for @ the resources not mentioned yet and the resource templates, which can be mentioned
 * again with other values; for / the prompts unless one is chosen already. Empty when there is nothing to offer,
 * which closes the menu.
 */
export function mentionOptions(
  mention: Mention | undefined,
  available: { resources?: readonly McpResourceInfo[]; resourceTemplates?: readonly McpResourceTemplateInfo[]; prompts?: readonly McpPromptInfo[] },
  chosen: { resources: readonly McpResourceInfo[]; prompt?: McpPromptInfo },
  limit = 8,
): MentionOption[] {
  if (mention?.kind === "resource") {
    const fresh = (available.resources ?? []).filter((resource) => !chosen.resources.some((other) => sameResource(resource, other)));
    const options: MentionOption[] = [
      ...fresh.map((resource) => ({ key: `${resource.server}\n${resource.uri}`, name: resource.name, detail: resource.description || resource.uri, server: resource.server, resource })),
      ...(available.resourceTemplates ?? []).map((template) => ({
        key: `${template.server}\n${template.uriTemplate}`,
        name: template.name,
        detail: template.description || template.uriTemplate,
        server: template.server,
        template,
      })),
    ];
    return rank(options, mention.query, (o) => [o.name], (o) => [o.detail, o.server, o.resource?.uri, o.template?.uriTemplate]).slice(0, limit);
  }
  if (mention?.kind === "prompt" && !chosen.prompt) {
    return matchPrompts(available.prompts ?? [], mention.query).map((prompt) => ({
      key: `${prompt.server}\n${prompt.name}`,
      name: promptLabel(prompt),
      detail: prompt.description || `/${prompt.name}`,
      server: prompt.server,
      prompt,
    }));
  }
  return [];
}

/** Replaces the mention with `@name `: the new text, and where the caret goes. */
export function insertMention(text: string, mention: Mention, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, mention.start) + inserted + text.slice(mention.end).replace(/^ /, ""), caret: mention.start + inserted.length };
}

/** Removes the mention, such as the /query typed to choose a prompt: the new text, and where the caret goes. */
export function removeMention(text: string, mention: Mention): { text: string; caret: number } {
  return { text: text.slice(0, mention.start) + text.slice(mention.end).replace(/^ /, ""), caret: mention.start };
}

/**
 * What a key does in an open menu of `count` options with option `active` highlighted: the option to highlight
 * next, "choose" the active one, or "close" the menu. Undefined for keys the menu leaves to the text box.
 */
export function mentionKey(key: string, active: number, count: number): number | "choose" | "close" | undefined {
  if (key === "ArrowDown") return (active + 1) % count;
  if (key === "ArrowUp") return (active - 1 + count) % count;
  if (key === "Enter" || key === "Tab") return "choose";
  if (key === "Escape") return "close";
  return undefined;
}

/** A prompt's name for people: its title, or its name when it has none. */
export function promptLabel(prompt: Pick<McpPromptInfo, "name" | "title">): string {
  return prompt.title || prompt.name;
}

/** Whether every argument the prompt requires has a value. */
export function promptReady(prompt: McpPromptInfo, values: Record<string, string>): boolean {
  return prompt.arguments.every((argument) => !argument.required || values[argument.name]?.trim());
}

/** A template's values with the spaces trimmed and the empty ones left out, in the order of its variables. */
export function templateValues(template: Pick<McpResourceTemplateInfo, "uriTemplate">, values: Record<string, string>): Record<string, string> {
  const given: Record<string, string> = {};
  for (const name of templateVariables(template.uriTemplate)) if (values[name]?.trim()) given[name] = values[name]!.trim();
  return given;
}

/** Whether every variable the template's URI needs has a value. */
export function templateReady(template: Pick<McpResourceTemplateInfo, "uriTemplate">, values: Record<string, string>): boolean {
  return requiredVariables(template.uriTemplate).every((name) => values[name]?.trim());
}

/** The fields a chosen prompt or resource template asks for: one per argument or variable. */
export interface ReferenceFields {
  /** Whose fields they are: "/Delay notice", or a template's name. */
  label: string;
  fields: { name: string; label: string; required: boolean; description?: string }[];
  /** The server suggests values for them. */
  completes: boolean;
  /** The question for suggestions in one field, given what's in all of them. */
  request(name: string, values: Record<string, string>): McpCompleteRequest;
}

export function promptFields(prompt: McpPromptInfo): ReferenceFields {
  return {
    label: `/${promptLabel(prompt)}`,
    fields: prompt.arguments.map((argument) => ({
      name: argument.name,
      label: argument.title || argument.name,
      required: Boolean(argument.required),
      description: argument.description,
    })),
    completes: Boolean(prompt.completes),
    request: (name, values) => ({ server: prompt.server, prompt: prompt.name, ...completion(name, values) }),
  };
}

export function templateFields(template: McpResourceTemplateInfo): ReferenceFields {
  const required = new Set(requiredVariables(template.uriTemplate));
  return {
    label: template.name,
    fields: templateVariables(template.uriTemplate).map((name) => ({ name, label: name, required: required.has(name) })),
    completes: Boolean(template.completes),
    request: (name, values) => ({ server: template.server, template: template.uriTemplate, ...completion(name, values) }),
  };
}

function completion(name: string, values: Record<string, string>) {
  const context = Object.fromEntries(Object.entries(values).filter(([other, value]) => other !== name && value.trim()));
  return { argument: name, value: values[name] ?? "", context: Object.keys(context).length ? context : undefined };
}

/**
 * Asks for suggestions as a person types into a field: after a pause, keeping only the answer to the latest
 * question for each field. `show` gets the field's key and the values.
 */
export function createSuggester(complete: (request: McpCompleteRequest) => Promise<string[]>, show: (key: string, values: string[]) => void, delay = 150) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const latest = new Map<string, number>();
  let asked = 0;
  return {
    ask(key: string, request: McpCompleteRequest) {
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          const id = ++asked;
          latest.set(key, id);
          complete(request).then(
            (values) => latest.get(key) === id && show(key, values),
            () => undefined,
          );
        }, delay),
      );
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      latest.clear();
    },
  };
}

/** A message's MCP resources and prompt, which show as chips. */
export function referenceParts(parts: readonly MessagePart[]): (ResourcePart | PromptPart)[] {
  return parts.filter((part): part is ResourcePart | PromptPart => part.type === "resource" || part.type === "prompt");
}

/** How a resource or prompt reads in a message: its icon and name, a prompt's values, and a tooltip. */
export function referenceView(part: ResourcePart | PromptPart): { icon: "file" | "chat"; name: string; detail?: string; title: string } {
  if (part.type === "resource") return { icon: "file", name: part.name, title: `${part.server}: ${part.uri}` };
  const values = Object.entries(part.arguments ?? {});
  return {
    icon: "chat",
    name: `/${promptLabel(part)}`,
    detail: values.map(([, value]) => value).join(" · ") || undefined,
    title: [`${part.server}: ${part.name}`, ...values.map(([name, value]) => `${name}: ${value}`)].join("\n"),
  };
}

/** Whether two resources are the same one. */
export function sameResource(a: Pick<McpResourceInfo, "server" | "uri">, b: Pick<McpResourceInfo, "server" | "uri">): boolean {
  return a.server === b.server && a.uri === b.uri;
}
