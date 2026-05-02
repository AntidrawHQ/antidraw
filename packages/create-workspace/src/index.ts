#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Options = {
  name?: string;
};

const parseArgs = (args: string[]): { destPath: string; options: Options } => {
  const options: Options = {};
  let destPath = ".";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--name" || arg === "-n") {
      options.name = args[++i];
    } else if (!arg.startsWith("-")) {
      destPath = arg;
    }
  }

  return { destPath, options };
};

// npm strips dotfiles like .gitignore from published packages, so the
// template stores it as `_gitignore` and we rename on copy.
const renameOnCopy: Record<string, string> = {
  _gitignore: ".gitignore",
};

const copyDir = (src: string, dest: string): void => {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const targetName = renameOnCopy[entry.name] ?? entry.name;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, targetName);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const updatePackageJson = (destPath: string, name: string): void => {
  const pkgPath = path.join(destPath, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  pkg.name = name;

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
};

const updateIndexHtml = (destPath: string, name: string): void => {
  const htmlPath = path.join(destPath, "index.html");
  let html = fs.readFileSync(htmlPath, "utf-8");

  html = html.replace(/<title>.*<\/title>/, `<title>${name}</title>`);

  fs.writeFileSync(htmlPath, html);
};

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: create-workspace [destination] [options]

Options:
  --name, -n    Project name (defaults to directory name)
  --help, -h    Show this help message

Examples:
  pnpm create @antidraw/workspace my-project
  pnpm create @antidraw/workspace ./projects/my-app --name my-app
`);
    process.exit(0);
  }

  const { destPath, options } = parseArgs(args);
  const resolvedDest = path.resolve(destPath);
  const projectName = options.name || path.basename(resolvedDest);

  // Check if destination exists and is not empty
  if (fs.existsSync(resolvedDest)) {
    const files = fs.readdirSync(resolvedDest);
    if (files.length > 0) {
      console.error(`Error: Directory "${resolvedDest}" is not empty.`);
      process.exit(1);
    }
  }

  console.log(`Creating Antidraw workspace: ${projectName}`);
  console.log(`Destination: ${resolvedDest}\n`);

  // Template is sibling to dist folder in the package
  const templateDir = path.join(__dirname, "..", "template");

  if (!fs.existsSync(templateDir)) {
    console.error("Error: Template directory not found.");
    console.error(`Expected at: ${templateDir}`);
    process.exit(1);
  }

  // Copy template
  console.log("Copying template files...");
  copyDir(templateDir, resolvedDest);

  // Update package.json with project name
  console.log("Configuring project...");
  updatePackageJson(resolvedDest, projectName);
  updateIndexHtml(resolvedDest, projectName);

  console.log(`
Done! Your workspace is ready.

Next steps:
  cd ${destPath}
  npm install
  npm run dev
`);
};

main();
