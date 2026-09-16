// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test, expect, beforeAll } from "vitest";
import { workspaceController } from "@/main/api/controllers/workspace.controller";
import { getComponentSource } from "@/main/api/services/component.service";
import { isComponentName } from "@/shared/utils/component-name";

const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();
const componentsDir = path.join(
  ROOT, "workspaces", workspaceId, "source", "src", "components", "user-components",
);

beforeAll(() => {
  mkdirSync(componentsDir, { recursive: true });
  // Names the old [a-zA-Z0-9_-] rule refused but the preview now accepts.
  for (const name of ["Q&A", "Card.v2", "Café", "A B", "404"]) {
    writeFileSync(path.join(componentsDir, `${name}.tsx`), `// ${name}\n`);
  }
  // A file one level up that a traversal would reach.
  writeFileSync(path.join(componentsDir, "..", "secret.tsx"), "// outside\n");
});

const get = (encodedName: string) =>
  workspaceController.request(`/${workspaceId}/components/${encodedName}/source`);

describe("GET /:workspaceId/components/:componentName/source", () => {
  test("any name a file can hold opens, arriving percent-encoded as the renderer sends it", async () => {
    for (const name of ["Q&A", "Card.v2", "Café", "A B", "404"]) {
      const res = await get(encodeURIComponent(name));
      expect(res.status, name).toBe(200);
      const body = await res.json();
      expect(body.name).toBe(name);
      expect(body.fileName).toBe(`${name}.tsx`);
      expect(body.source).toBe(`// ${name}\n`);
    }
  });

  test("a traversal is rejected by the route and never read", async () => {
    // Hono decodes %2F to "/", which the rule refuses (400). A literal ".."
    // segment is collapsed by URL normalisation before routing and lands on
    // no route at all (404). Either way the file is never read.
    for (const encoded of ["..%2Fsecret", "%2E%2E%2Fsecret", "..", "a%5Cb"]) {
      const res = await get(encoded);
      expect([400, 404], encoded).toContain(res.status);
      expect(await res.text()).not.toContain("outside");
    }
  });

  test("the service refuses to leave the directory even when called directly", async () => {
    const result = await getComponentSource(workspaceId, "../secret");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe("NOT_FOUND");
  });

  test("a missing component is a 404", async () => {
    const res = await get("Nope");
    expect(res.status).toBe(404);
  });

  test("the rule accepts what the preview accepts", () => {
    for (const ok of ["Q&A", "Card.v2", "Café", "A B", "404", "what?", "#1", ".hidden"]) expect(isComponentName(ok), ok).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "a\0b", "../x"]) expect(isComponentName(bad), JSON.stringify(bad)).toBe(false);
  });
});
