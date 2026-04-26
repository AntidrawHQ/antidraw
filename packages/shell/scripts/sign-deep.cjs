const { execSync } = require("node:child_process");
const path = require("node:path");

// macOS 26+ rejects loading frameworks whose Team ID differs from the host
// process. electron-builder's default ad-hoc sign only signs the main binary,
// leaving the Electron Framework with its original signature — crash on launch.
// Re-sign the entire bundle with --force --deep so every nested binary shares
// the same ad-hoc identity. We must pass --entitlements explicitly: codesign
// drops the entitlements applied by electron-builder's prior signing pass,
// and without the JIT / unsigned-executable-memory entitlements V8 cannot
// allocate executable memory and the renderer crashes on launch.
// Skipped when a real signing cert is configured.
exports.default = async (context) => {
  if (context.electronPlatformName !== "darwin") return;

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log("[sign-deep] real signing identity detected, skipping");
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlements = path.join(
    __dirname,
    "..",
    "build",
    "entitlements.mac.plist",
  );

  console.log(`[sign-deep] codesign --force --deep --sign - ${appPath}`);
  execSync(
    `codesign --force --deep --sign - --entitlements "${entitlements}" "${appPath}"`,
    { stdio: "inherit" },
  );
};
