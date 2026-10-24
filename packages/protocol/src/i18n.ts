/** Values for a message's placeholders. */
export type MessageValues = Record<string, string | number>;

/** A piece of a formatted message: literal text, or the value of the argument named `arg`. */
export interface MessageFragment {
  text: string;
  arg?: string;
}

// ---------------------------------------------------------------------------------------------
// Messages: a parser and formatter for the subset of ICU MessageFormat the catalogs use.

const HASH = { hash: true } as const;
type Node = string | typeof HASH | { arg: string } | { arg: string; type: "plural" | "selectordinal" | "select"; options: Record<string, Node[]> };

class Parser {
  private i = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): Node[] {
    const nodes = this.nodes(false, false);
    if (this.i < this.source.length) throw new SyntaxError(`Unexpected "}" at ${this.i}`);
    return nodes;
  }

  /** Text and arguments up to the end, or up to the `}` that closes a branch. */
  private nodes(inPlural: boolean, inBranch: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push(text);
      text = "";
    };
    while (this.i < this.source.length) {
      const ch = this.source[this.i]!;
      if (ch === "}") {
        if (inBranch) break;
        throw new SyntaxError(`Unexpected "}" at ${this.i}`);
      }
      if (ch === "'") text += this.quoted(inPlural);
      else if (ch === "{") {
        flush();
        this.i++;
        out.push(this.argument(inPlural));
      } else if (ch === "#" && inPlural) {
        flush();
        out.push(HASH);
        this.i++;
      } else {
        text += ch;
        this.i++;
      }
    }
    flush();
    return out;
  }

  /** ICU quoting: '' is an apostrophe, and a quote before { } or # starts literal text that ends at the next quote. */
  private quoted(inPlural: boolean): string {
    const s = this.source;
    const next = s[this.i + 1];
    if (next === "'") {
      this.i += 2;
      return "'";
    }
    if (next !== "{" && next !== "}" && !(inPlural && next === "#")) {
      this.i++;
      return "'";
    }
    let text = "";
    this.i++;
    while (this.i < s.length) {
      if (s[this.i] === "'") {
        if (s[this.i + 1] !== "'") break;
        text += "'";
        this.i += 2;
      } else text += s[this.i++];
    }
    this.i++;
    return text;
  }

  private argument(inPlural: boolean): Node {
    const arg = this.until(",}").trim();
    if (!arg) throw new SyntaxError(`Empty argument at ${this.i}`);
    if (this.source[this.i++] === "}") return { arg };
    const type = this.until(",}").trim();
    if (type !== "plural" && type !== "selectordinal" && type !== "select") {
      // {n, number} and other formats show the value; their style is ignored.
      this.until("}");
      this.i++;
      return { arg };
    }
    if (this.source[this.i++] !== ",") throw new SyntaxError(`Expected options for ${arg}`);
    const options: Record<string, Node[]> = {};
    for (;;) {
      this.skipSpace();
      if (this.source[this.i] === "}") break;
      const selector = this.until("{} \t\n\r");
      this.skipSpace();
      if (!selector || this.source[this.i] !== "{") throw new SyntaxError(`Expected "{" after ${selector || "a selector"}`);
      this.i++;
      options[selector] = this.nodes(inPlural || type !== "select", true);
      if (this.source[this.i] !== "}") throw new SyntaxError(`Unclosed option ${selector}`);
      this.i++;
    }
    this.i++;
    if (!options.other) throw new SyntaxError(`${arg} needs an "other" option`);
    return { arg, type, options };
  }

  /** Reads up to (not past) one of the characters; the end of the source is an error. */
  private until(stops: string): string {
    const start = this.i;
    while (this.i < this.source.length && !stops.includes(this.source[this.i]!)) this.i++;
    if (this.i >= this.source.length) throw new SyntaxError("Unclosed argument");
    return this.source.slice(start, this.i);
  }

  private skipSpace() {
    while (/\s/.test(this.source[this.i] ?? "")) this.i++;
  }
}

const parsed = new Map<string, Node[]>();

function parse(template: string): Node[] {
  let nodes = parsed.get(template);
  if (!nodes) {
    try {
      nodes = new Parser(template).parse();
    } catch {
      // A malformed translation shows as written rather than breaking the UI.
      nodes = [template];
    }
    parsed.set(template, nodes);
  }
  return nodes;
}

interface Context {
  number(value: number): string;
  plural(value: number, ordinal: boolean): string;
}

function render(nodes: Node[], values: MessageValues, context: Context, out: MessageFragment[], count?: number) {
  const text = (value: string) => {
    const last = out[out.length - 1];
    if (last && last.arg === undefined) last.text += value;
    else out.push({ text: value });
  };
  for (const node of nodes) {
    if (typeof node === "string") text(node);
    else if ("hash" in node) text(count === undefined ? "#" : context.number(count));
    else if ("options" in node) {
      const value = values[node.arg];
      if (node.type === "select") {
        render(node.options[String(value)] ?? node.options.other!, values, context, out, count);
      } else {
        const n = Number(value);
        const branch = node.options[`=${n}`] ?? node.options[context.plural(n, node.type === "selectordinal")] ?? node.options.other!;
        render(branch, values, context, out, n);
      }
    } else {
      const value = values[node.arg];
      // A missing value stays visible as {name}, so the mistake is easy to spot.
      out.push({ text: value === undefined ? `{${node.arg}}` : typeof value === "number" ? context.number(value) : value, arg: node.arg });
    }
  }
}

/** Formats an ICU message with its values, in the given locale's plural rules and number format. */
export function formatMessage(template: string, values: MessageValues = {}, locale?: string): string {
  return messageParts(template, values, locale)
    .map((part) => part.text)
    .join("");
}

/** The message in pieces, so a UI can style the values. Plurals follow `locale`, numbers `formatLocale`. */
export function messageParts(template: string, values: MessageValues, locale: string | undefined, formatLocale = locale): MessageFragment[] {
  const out: MessageFragment[] = [];
  render(parse(template), values, {
    number: (value) => numberFormat(formatLocale, { maximumFractionDigits: 2 }).format(value),
    plural: (value, ordinal) => pluralRules(locale ?? "en", ordinal).select(value),
  }, out);
  return out;
}

const formats = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  let value = formats.get(key) as T | undefined;
  if (value === undefined) {
    value = make();
    // Keys hold a locale, which on a server comes from a request header: start over rather than grow without bound.
    if (formats.size >= 200) formats.clear();
    formats.set(key, value);
  }
  return value;
}

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions) {
  return cached(`n|${locale}|${JSON.stringify(options)}`, () => new Intl.NumberFormat(locale, options));
}

function pluralRules(locale: string, ordinal: boolean) {
  return cached(`p|${locale}|${ordinal}`, () => new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" }));
}

// ---------------------------------------------------------------------------------------------
// Languages.

/**
 * The language among `available` closest to a BCP 47 tag: "de-AT" gives "de", "pt" gives "pt-BR", "zh-CN" gives
 * "zh-Hans". Undefined when none fits, so the caller falls back to English.
 */
export function matchLocale<L extends string>(tag: string | undefined, available: readonly L[]): L | undefined {
  const valid = validLocale(tag);
  if (!valid) return undefined;
  const exact = available.find((locale) => locale.toLowerCase() === valid.toLowerCase());
  if (exact) return exact;
  const parsed = new Intl.Locale(valid);
  if (parsed.language === "zh") {
    const script = parsed.maximize().script;
    return available.find((locale) => locale === `zh-${script}`);
  }
  return (
    available.find((locale) => locale === parsed.language) ??
    available.find((locale) => new Intl.Locale(locale).language === parsed.language)
  );
}

/** The tag if Intl accepts it, else undefined: a bad tag (say "en_US") would make every formatter throw. */
export function validLocale(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  try {
    return Intl.getCanonicalLocales(tag.replace(/_/g, "-"))[0];
  } catch {
    return undefined;
  }
}