/** Shows a value the way Vue's {{ }} does, so every binding prints the same: blank for null, JSON for objects. */
export function displayText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
