import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { globSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginRuntimeDir = join(repoRoot, "packages", "plugin-runtime");
const workspacesDir = join(homedir(), ".antidraw", "workspaces");

// 1. Read version from plugin-runtime package.json
const runtimePkg = JSON.parse(
  readFileSync(join(pluginRuntimeDir, "package.json"), "utf-8")
);
const version = runtimePkg.version;
console.log(`@antidrawapp/runtime version: ${version}\n`);

// 2. Find all workspace package.json files
const workspacePackageJsons = globSync(
  join(workspacesDir, "*/source/package.json")
);

if (workspacePackageJsons.length === 0) {
  console.log("No workspaces found in ~/.antidraw/workspaces/");
  process.exit(0);
}

console.log(`Found ${workspacePackageJsons.length} workspace(s).\n`);

// 3. Update each workspace
for (const pkgJsonPath of workspacePackageJsons) {
  const sourceDir = dirname(pkgJsonPath);
  const workspaceName = resolve(sourceDir, "..").split("/").pop();

  console.log(`Updating workspace: ${workspaceName}`);

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies["@antidrawapp/runtime"] = `^${version}`;
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  Set @antidrawapp/runtime -> ^${version}`);

  console.log(`  Running npm install...`);
  execSync("npm install", { cwd: sourceDir, stdio: "inherit" });
  console.log(`  Done.\n`);
}

console.log("All workspaces updated to use npm registry runtime.");
