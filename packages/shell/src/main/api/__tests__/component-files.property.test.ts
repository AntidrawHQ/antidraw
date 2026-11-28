// Imported FIRST: relocates ~/.antidraw to a fresh tmp dir — see e2e-env.ts.
import "./e2e-env";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { expect, test } from "vitest";
import { workspaceController } from "@/main/api/controllers/workspace.controller";

// A batch of new components against the files already there: all of it is
// written, or none, and a file already there is never changed. Names from a
// few letters in both cases, so batches collide with themselves and with
// the files, as macOS's file system sees names (case ignored).

const ROOT = process.env.ANTIDRAW_ROOT!;
const workspaceId = crypto.randomUUID();
const componentsDir = path.join(ROOT, "workspaces", workspaceId, "source", "src", "components", "user-components");

const letter = fc.constantFrom("A", "a", "B", "b", "C");
const files = () =>
  Object.fromEntries(readdirSync(componentsDir).map((f) => [f, readFileSync(path.join(componentsDir, f), "utf-8")]));

test("writes the whole batch or none of it, and never changes a file that's there", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(letter, { maxLength: 3, selector: (n) => n.toLowerCase() }),
      fc.array(letter, { minLength: 1, maxLength: 4 }),
      async (existing, batch) => {
        rmSync(componentsDir, { recursive: true, force: true });
        mkdirSync(componentsDir, { recursive: true });
        for (const name of existing) writeFileSync(path.join(componentsDir, `${name}.tsx`), `// old ${name}\n`);
        const before = files();

        const res = await workspaceController.request(`/${workspaceId}/components`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ components: batch.map((name, i) => ({ name, source: `// new ${name} ${i}\n` })) }),
        });

        const lower = batch.map((n) => n.toLowerCase());
        const clash = new Set(lower).size !== lower.length;
        const taken = lower.some((n) => existing.some((e) => e.toLowerCase() === n));
        const expected = clash ? 400 : taken ? 409 : 200;
        expect(res.status).toBe(expected);
        if (expected === 200) {
          expect(files()).toEqual({
            ...before,
            ...Object.fromEntries(batch.map((name, i) => [`${name}.tsx`, `// new ${name} ${i}\n`])),
          });
        } else {
          expect(files()).toEqual(before);
        }
      },
    ),
    { numRuns: 60 },
  );
});
