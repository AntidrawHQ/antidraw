import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// renderer/canvas/ is also the share page's canvas (@antidraw/share-page),
// which runs on the web: no Electron, no antidraw:// API, no shell stores.
// Everything it imports is listed here, so a new import shows up in review.

const dir = path.resolve(__dirname, "..");

it("imports only what the share page can run", () => {
  const imports = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+["']([^"']+)["']/gm)) {
      imports.add(specifier!);
    }
    for (const [, specifier] of source.matchAll(/^import\s+["']([^"']+)["']/gm)) imports.add(specifier!);
  }
  expect([...imports].sort()).toMatchInlineSnapshot(`
    [
      "./Canvas",
      "./PillToggleToolbar",
      "./canvas.css",
      "./semaphore",
      "@/renderer/hooks/use-mount-effect",
      "@/renderer/lib/utils",
      "@xyflow/react",
      "@xyflow/react/dist/style.css",
      "lucide-react",
      "motion/react",
      "react",
    ]
  `);
});
