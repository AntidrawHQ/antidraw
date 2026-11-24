// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { workspaceController } from "@/main/api/controllers/workspace.controller";
import { setTrashItemForTests } from "@/main/api/services/component.service";

// The canvas's own changes to its frames' files: new ones (a paste, a
// duplicate, an undone delete) and deleted ones, which go to the trash.

const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();
const componentsDir = path.join(
  ROOT, "workspaces", workspaceId, "source", "src", "components", "user-components",
);
const file = (name: string) => path.join(componentsDir, `${name}.tsx`);

let trashed: string[] = [];
let trashFails = new Set<string>();
setTrashItemForTests(async (filePath) => {
  if (trashFails.has(path.basename(filePath))) throw new Error("trash refused");
  trashed.push(path.basename(filePath));
  rmSync(filePath);
});

beforeEach(() => {
  rmSync(componentsDir, { recursive: true, force: true });
  mkdirSync(componentsDir, { recursive: true });
  writeFileSync(file("Card"), "// Card\n");
  writeFileSync(path.join(componentsDir, "..", "secret.tsx"), "// outside\n");
  trashed = [];
  trashFails = new Set();
});

const post = (route: string, body: unknown) =>
  workspaceController.request(`/${workspaceId}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const create = (components: { name: string; source: string }[]) => post("/components", { components });
const del = (names: string[], expected?: Record<string, string>) =>
  post("/components/delete", { names, expected });

describe("POST /:workspaceId/components", () => {
  test("writes each new component's file", async () => {
    const res = await create([
      { name: "CardCopy", source: "// one\n" },
      { name: "Hero Card", source: "// two\n" },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: ["CardCopy", "Hero Card"] });
    expect(readFileSync(file("CardCopy"), "utf-8")).toBe("// one\n");
    expect(readFileSync(file("Hero Card"), "utf-8")).toBe("// two\n");
  });

  test("never overwrites a taken name, whatever its case, and writes none of the batch", async () => {
    for (const taken of ["Card", "card"]) {
      const res = await create([
        { name: "Fresh", source: "// fresh\n" },
        { name: taken, source: "// replaced\n" },
      ]);
      expect(res.status, taken).toBe(409);
      expect(readFileSync(file("Card"), "utf-8")).toBe("// Card\n");
      expect(existsSync(file("Fresh")), taken).toBe(false);
    }
  });

  test("refuses two new components that would be one file", async () => {
    const res = await create([
      { name: "Twin", source: "" },
      { name: "twin", source: "" },
    ]);
    expect(res.status).toBe(400);
    expect(existsSync(file("Twin"))).toBe(false);
  });

  test("a name that would leave the directory is refused", async () => {
    for (const name of ["../secret", "a/b", ".."]) {
      const res = await create([{ name, source: "// escaped\n" }]);
      expect(res.status, name).toBe(400);
    }
    expect(readFileSync(path.join(componentsDir, "..", "secret.tsx"), "utf-8")).toBe("// outside\n");
  });
});

describe("POST /:workspaceId/components/delete", () => {
  test("trashes each file and answers with its source", async () => {
    writeFileSync(file("Hero"), "// Hero\n");
    const res = await del(["Card", "Hero"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: [
        { name: "Card", source: "// Card\n" },
        { name: "Hero", source: "// Hero\n" },
      ],
      failed: [],
    });
    expect(trashed).toEqual(["Card.tsx", "Hero.tsx"]);
  });

  test("a file changed since the canvas saw it is left, and so is the rest", async () => {
    writeFileSync(file("Hero"), "// Hero, edited by the agent\n");
    const res = await del(["Card", "Hero"], { Card: "// Card\n", Hero: "// Hero\n" });
    expect(res.status).toBe(409);
    expect(trashed).toEqual([]);
    expect(existsSync(file("Card"))).toBe(true);
  });

  test("a file the trash refuses is listed, and the others still go", async () => {
    writeFileSync(file("Hero"), "// Hero\n");
    trashFails.add("Card.tsx");
    const res = await del(["Card", "Hero"]);
    expect(await res.json()).toEqual({
      deleted: [{ name: "Hero", source: "// Hero\n" }],
      failed: ["Card"],
    });
    expect(existsSync(file("Card"))).toBe(true);
  });

  test("a missing component is a 404, and nothing is deleted", async () => {
    const res = await del(["Card", "Nope"]);
    expect(res.status).toBe(404);
    expect(trashed).toEqual([]);
  });

  test("a name that would leave the directory is refused", async () => {
    const res = await del(["../secret"]);
    expect(res.status).toBe(400);
    expect(existsSync(path.join(componentsDir, "..", "secret.tsx"))).toBe(true);
  });
});
