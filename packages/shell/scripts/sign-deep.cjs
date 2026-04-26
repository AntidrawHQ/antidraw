const { execSync } = require("node:child_process");
const path = require("node:path");

// macOS 26+ rejects loading frameworks whose Team ID differs from the host
// process. electron-builder's default ad-hoc sign only signs the main binary,
// leaving the Electron Framework with its original signature — crash on launch.
// Re-sign the entire bundle with --force --deep so every nested binary shares
// the same ad-hoc identity. Skipped when a real signing cert is configured.
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

  console.log(`[sign-deep] codesign --force --deep --sign -  ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, {
    stdio: "inherit",
  });
};
