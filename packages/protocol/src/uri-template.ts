/**
 * RFC 6570 URI templates, as MCP resource templates use them: `{id}`, and the operators + # . / ; ? & with
 * comma-separated names. Prefix (`{id:3}`) and explode (`{path*}`) modifiers are accepted but not applied.
 */
const EXPRESSION = /\{([+#./;?&]?)([^{}]+)\}/g;

function names(list: string): string[] {
  return list.split(",").map((name) => name.trim().replace(/(\*|:\d+)$/, ""));
}

/** The template's variables, each once, in order. */
export function templateVariables(template: string): string[] {
  const found = new Set<string>();
  for (const [, , list] of template.matchAll(EXPRESSION)) for (const name of names(list!)) found.add(name);
  return [...found];
}

/** The variables a URI needs a value for: all but query ones (`{?q}`, `{&page}`), which can be left out. */
export function requiredVariables(template: string): string[] {
  const optional = new Set<string>();
  for (const [, operator, list] of template.matchAll(EXPRESSION)) if (operator === "?" || operator === "&") for (const name of names(list!)) optional.add(name);
  return templateVariables(template).filter((name) => !optional.has(name));
}

/** Fills in a template. Variables without a value are left out, as RFC 6570 says. */
export function expandTemplate(template: string, values: Record<string, string | undefined>): string {
  return template.replace(EXPRESSION, (_, operator: string, list: string) => {
    const given = names(list).filter((name) => values[name]);
    if (!given.length) return "";
    const reserved = operator === "+" || operator === "#";
    const encode = (name: string) => {
      const value = values[name]!;
      return reserved ? encodeURI(value) : encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    };
    const pairs = (separator: string) => given.map((name) => `${name}=${encode(name)}`).join(separator);
    switch (operator) {
      case "#":
        return `#${given.map(encode).join(",")}`;
      case ".":
        return `.${given.map(encode).join(".")}`;
      case "/":
        return `/${given.map(encode).join("/")}`;
      case ";":
        return `;${pairs(";")}`;
      case "?":
        return `?${pairs("&")}`;
      case "&":
        return `&${pairs("&")}`;
      default:
        return given.map(encode).join(",");
    }
  });
}

/** The name a resource from a template goes by: the template's name and the values that pick it, "Order: 1042". */
export function templatedName(name: string, values: Record<string, string | undefined>): string {
  const picked = Object.values(values).filter(Boolean).join(", ");
  return picked ? `${name}: ${picked}` : name;
}
