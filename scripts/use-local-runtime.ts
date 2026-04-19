import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { globSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const pluginRuntimeDir = join(repoRoot, "packages", "plugin-runtime");
const workspacesDir = join(homedir(), ".antidraw", "workspaces");

// 1. Build plugin-runtime
console.log("Building @antidrawapp/runtime...");
execSync("npm run build", { cwd: pluginRuntimeDir, stdio: "inherit" });
console.log("Build complete.\n");

// 2. Delete existing .tgz files
const existingTarballs = readdirSync(pluginRuntimeDir).filter((f) =>
  f.endsWith(".tgz")
);
for (const tarball of existingTarballs) {
  const tarballPath = join(pluginRuntimeDir, tarball);
  console.log(`Deleting old tarball: ${tarball}`);
  unlinkSync(tarballPath);
}

// 3. Pack and capture the tarball filename
console.log("Running npm pack...");
const tarballFilename = execSync("npm pack", {
  cwd: pluginRuntimeDir,
})
  .toString()
  .trim();
const tarballPath = join(pluginRuntimeDir, tarballFilename);
console.log(`Created tarball: ${tarballPath}\n`);

// 4. Find all workspace package.json files
const workspacePackageJsons = globSync(
  join(workspacesDir, "*/source/package.json")
);

if (workspacePackageJsons.length === 0) {
  console.log("No workspaces found in ~/.antidraw/workspaces/");
  process.exit(0);
}

console.log(`Found ${workspacePackageJsons.length} workspace(s).\n`);

// 5. Update each workspace
for (const pkgJsonPath of workspacePackageJsons) {
  const sourceDir = dirname(pkgJsonPath);
  const workspaceName = resolve(sourceDir, "..").split("/").pop();

  console.log(`Updating workspace: ${workspaceName}`);

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies["@antidrawapp/runtime"] = `file:${tarballPath}`;
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(
    `  Set @antidrawapp/runtime -> file:${tarballPath}`
  );

  console.log(`  Running npm install...`);
  try {
    execSync("npm install", { cwd: sourceDir, stdio: "inherit" });
    console.log(`  Done.\n`);
  } catch {
    console.warn(`  ⚠ npm install failed for ${workspaceName}, skipping.\n`);
  }
}

console.log("All workspaces updated to use local runtime.");
