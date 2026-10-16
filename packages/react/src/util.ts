/** Joins class names, skipping empty ones: cx("a", on && "b"). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Shows a value the way Vue's {{ }} does, so both bindings print the same: blank for null, JSON for objects. */
export function displayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
