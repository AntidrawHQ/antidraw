import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Builds dist/plugin.js, which workspaces import as @antidrawapp/runtime/plugin
// and which finds the runtime's src/ relative to itself.
export default function setup() {
  execFileSync("npm", ["run", "build"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "ignore",
  })
}
