import { describe, expect, it } from "vitest";
import { expandTemplate, requiredVariables, templatedName, templateVariables } from "./uri-template.ts";

describe("URI templates", () => {
  it("lists variables, and the ones a URI can't do without", () => {
    expect(templateVariables("orders://{id}/lines{?page,size}{&sort}")).toEqual(["id", "page", "size", "sort"]);
    expect(requiredVariables("orders://{id}/lines{?page,size}{&sort}")).toEqual(["id"]);
    expect(templateVariables("files://{+path*}/{name:3}{/rest}")).toEqual(["path", "name", "rest"]);
  });

  it("expands each operator, encoding what it should", () => {
    expect(expandTemplate("orders://{id}", { id: "A 1/2" })).toBe("orders://A%201%2F2");
    expect(expandTemplate("files://{+path}", { path: "a/b c" })).toBe("files://a/b%20c");
    expect(expandTemplate("x{#frag}{.ext}{/a,b}", { frag: "top", ext: "md", a: "1", b: "2" })).toBe("x#top.md/1/2");
    expect(expandTemplate("x{;v}{?q,page}{&sort}", { v: "1", q: "tent (2p)", sort: "asc" })).toBe("x;v=1?q=tent%20%282p%29&sort=asc");
    expect(expandTemplate("orders{?status,page}", {})).toBe("orders");
  });

  it("names a resource after its template and the values that pick it", () => {
    expect(templatedName("Order", { id: "1042" })).toBe("Order: 1042");
    expect(templatedName("Order", { id: "" })).toBe("Order");
  });
});
