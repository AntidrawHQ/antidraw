import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup() {
  execFileSync("npx", ["vite", "build", "--logLevel", "error"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
  });
}
