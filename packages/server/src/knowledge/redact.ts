/**
 * Resolved tickets carry customers' names, addresses and orders. Before a ticket is indexed, what
 * identifies its customer is replaced with placeholders, so a reply drafted from it can't pass one
 * customer's details to another.
 */

export interface TicketMessage {
  /** "customer" for the customer; anything else is a member of staff, by name or role. */
  from: string;
  text: string;
  at?: string;
}

export interface KnowledgeTicket {
  id: string | number;
  subject: string;
  /** The conversation, oldest first. */
  messages: TicketMessage[];
  /** How it was resolved, when the helpdesk records it. */
  resolution?: string;
  /** Who it was from. Each of these is removed wherever it appears, names in parts too. */
  customer?: { name?: string; email?: string; phone?: string; address?: string | string[]; company?: string };
  /** Other values that point to the customer, also removed: order, tracking and account numbers. */
  private?: (string | number)[];
  tags?: string[];
  /** Where staff open it in the helpdesk. */
  url?: string;
  closedAt?: string;
}

export interface RedactOptions {
  /** More patterns to remove, such as your order numbers' format: /#\d{4,}/g. Replaced with `[redacted]` unless given a replacement. */
  patterns?: (RegExp | { pattern: RegExp; replacement: string })[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const PHONE = /(?<![\w+])\+?\d[\d\s().-]{6,}\d(?!\w)/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches `value` as whole words. */
const wholeWords = (value: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, flags);

/** A function that removes the ticket's customer from a text. */
export function ticketRedactor(ticket: KnowledgeTicket, options: RedactOptions = {}): (text: string) => string {
  const rules: [RegExp, string | ((match: string) => string)][] = [];
  const customer = ticket.customer ?? {};
  const literal = (value: string | undefined, replacement: string, caseSensitive = false) => {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length >= 2) rules.push([wholeWords(trimmed, caseSensitive ? "gu" : "giu"), replacement]);
  };
  // Longest first, so "Jane Cooper" goes before "Jane".
  literal(customer.email, "[email]");
  literal(customer.name, "[customer]");
  for (const part of customer.name?.split(/\s+/) ?? []) {
    // Name parts match capitalized, as names are written: "Will" goes, the verb "will" stays.
    if (part.replace(/\W/g, "").length >= 2) literal(part.replace(/[.,]$/, ""), "[customer]", true);
  }
  literal(customer.company, "[company]");
  const addresses = Array.isArray(customer.address) ? customer.address : customer.address ? [customer.address] : [];
  for (const address of addresses) {
    literal(address, "[address]");
    for (const part of address.split(/[,\n]/)) if (part.trim().length >= 4) literal(part, "[address]");
  }
  if (customer.phone) {
    const digits = customer.phone.replace(/\D/g, "");
    if (digits.length >= 6) rules.push([new RegExp(`\\+?${digits.split("").join("[\\s().-]*")}`, "g"), "[phone]"]);
  }
  for (const value of ticket.private ?? []) literal(String(value), "[redacted]");
  for (const extra of options.patterns ?? []) {
    const { pattern, replacement } = extra instanceof RegExp ? { pattern: extra, replacement: "[redacted]" } : extra;
    rules.push([pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`), replacement]);
  }
  rules.push([EMAIL, "[email]"], [IBAN, "[account]"], [CARD, "[card]"]);
  // Dates look like phone numbers to the pattern; they stay.
  rules.push([PHONE, (match) => (match.replace(/\D/g, "").length < 7 || /^\d{4}-\d{2}-\d{2}$/.test(match) ? match : "[phone]")]);
  return (text) => rules.reduce((out, [pattern, replacement]) => out.replace(pattern, typeof replacement === "string" ? () => replacement : replacement), text);
}

/** The ticket as Markdown for the index: its subject, the conversation and the resolution, without its customer. */
export function ticketMarkdown(ticket: KnowledgeTicket, redact: false | RedactOptions = {}): { title: string; text: string } {
  const clean = redact === false ? (text: string) => text : ticketRedactor(ticket, redact);
  const author = (from: string) => (from.toLowerCase() === "customer" ? "Customer" : clean(from));
  const lines = ticket.messages.map((message) => `**${author(message.from)}:** ${clean(message.text.trim())}`);
  if (ticket.resolution?.trim()) lines.push(`**Resolution:** ${clean(ticket.resolution.trim())}`);
  if (ticket.tags?.length) lines.push(`Tags: ${ticket.tags.join(", ")}`);
  return { title: clean(ticket.subject), text: lines.join("\n\n") };
}
