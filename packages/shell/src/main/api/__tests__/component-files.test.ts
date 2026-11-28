// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
// What else happens as a file goes to the trash: the agent, still at work.
let whileTrashing: (file: string) => void = () => {};
setTrashItemForTests(async (filePath) => {
  whileTrashing(path.basename(filePath));
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
  whileTrashing = () => {};
});
afterEach(() => vi.restoreAllMocks());

const post = (route: string, body: unknown) =>
  workspaceController.request(`/${workspaceId}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const create = (components: { name: string; source: string }[]) => post("/components", { components });
const del = (names: string[], expected?: Record<string, string>) =>
  post("/components/delete", {
    names,
    expected: expected && Object.entries(expected).map(([name, source]) => ({ name, source })),
  });

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

  test("a write that fails part way leaves none of the batch, the file it failed on too", async () => {
    // The disk fills: the file is made, and the write into it fails.
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (target, ...rest) => {
      if (String(target) !== file("Second")) return writeFile(target, ...rest);
      writeFileSync(file("Second"), "");
      throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
    });
    const res = await create([
      { name: "First", source: "// one\n" },
      { name: "Second", source: "// two\n" },
      { name: "Third", source: "// three\n" },
    ]);
    expect(res.status).toBe(500);
    expect(["First", "Second", "Third"].filter((name) => existsSync(file(name)))).toEqual([]);
  });

  test("a file that turns up as the batch is written is left as it is, and the batch isn't", async () => {
    // Between the check of the names and the write: the agent's, not ours.
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (target, ...rest) => {
      if (String(target) === file("Second")) writeFileSync(file("Second"), "// the agent's\n");
      return writeFile(target, ...rest);
    });
    const res = await create([
      { name: "First", source: "// one\n" },
      { name: "Second", source: "// two\n" },
    ]);
    expect(res.status).toBe(409);
    expect(existsSync(file("First"))).toBe(false);
    expect(readFileSync(file("Second"), "utf-8")).toBe("// the agent's\n");
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
      missing: [],
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

  test("a file edited while the ones before it go is left, when the canvas said what it saw", async () => {
    writeFileSync(file("Hero"), "// Hero\n");
    whileTrashing = (name) => name === "Card.tsx" && writeFileSync(file("Hero"), "// Hero, edited\n");
    const res = await del(["Card", "Hero"], { Card: "// Card\n", Hero: "// Hero\n" });
    expect(await res.json()).toEqual({ deleted: [{ name: "Card", source: "// Card\n" }], failed: ["Hero"], missing: [] });
    expect(readFileSync(file("Hero"), "utf-8")).toBe("// Hero, edited\n");
  });

  test("and goes as edited when it didn't: the source an undo writes back", async () => {
    writeFileSync(file("Hero"), "// Hero\n");
    whileTrashing = (name) => name === "Card.tsx" && writeFileSync(file("Hero"), "// Hero, edited\n");
    const res = await del(["Card", "Hero"]);
    expect((await res.json()).deleted[1]).toEqual({ name: "Hero", source: "// Hero, edited\n" });
  });

  test("checks a frame named for something every object has", async () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      writeFileSync(file(name), "// as written\n");
      expect((await del([name], { [name]: "// as it was\n" })).status, name).toBe(409);
      expect((await del([name], { [name]: "// as written\n" })).status, name).toBe(200);
    }
  });

  test("a file the trash refuses is listed, and the others still go", async () => {
    writeFileSync(file("Hero"), "// Hero\n");
    trashFails.add("Card.tsx");
    const res = await del(["Card", "Hero"]);
    expect(await res.json()).toEqual({
      deleted: [{ name: "Hero", source: "// Hero\n" }],
      failed: ["Card"],
      missing: [],
    });
    expect(existsSync(file("Card"))).toBe(true);
  });

  test("a file that's gone already is listed, and the rest still go", async () => {
    // With what the canvas saw of each, as an undone paste has: one the
    // agent has deleted since doesn't keep the others.
    const res = await del(["Card", "Nope"], { Card: "// Card\n", Nope: "// Nope\n" });
    expect(await res.json()).toEqual({ deleted: [{ name: "Card", source: "// Card\n" }], failed: [], missing: ["Nope"] });
    // And one that goes while the ones before it do.
    writeFileSync(file("Card"), "// Card\n");
    writeFileSync(file("Hero"), "// Hero\n");
    whileTrashing = (name) => name === "Card.tsx" && rmSync(file("Hero"));
    expect((await (await del(["Card", "Hero"])).json()).missing).toEqual(["Hero"]);
  });

  test("with none of them there, a 404", async () => {
    const res = await del(["Nope", "Gone"]);
    expect(res.status).toBe(404);
    expect(trashed).toEqual([]);
  });

  test("a name that would leave the directory is refused", async () => {
    const res = await del(["../secret"]);
    expect(res.status).toBe(400);
    expect(existsSync(path.join(componentsDir, "..", "secret.tsx"))).toBe(true);
  });
});
