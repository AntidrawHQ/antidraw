import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { TestProject } from "vitest/node"

// Builds dist/plugin.js, which workspaces import as @antidrawapp/runtime/plugin
// and which finds the runtime's src/ relative to itself.
const buildPlugin = () => {
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "pipe",
    })
  } catch (error) {
    const { stdout, stderr } = error as { stdout: Buffer; stderr: Buffer }
    throw new Error(`Building dist/plugin.js failed:\n${stdout}${stderr}`)
  }
}

export default function setup(project: TestProject) {
  buildPlugin()
  // In watch mode, each rerun builds it again (see forceRerunTriggers).
  project.onTestsRerun(buildPlugin)
}
