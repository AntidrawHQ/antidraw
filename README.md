```
 █████  ███    ██ ████████ ██ ██████  ██████   █████  ██     ██
██   ██ ████   ██    ██    ██ ██   ██ ██   ██ ██   ██ ██     ██
███████ ██ ██  ██    ██    ██ ██   ██ ██████  ███████ ██  █  ██
██   ██ ██  ██ ██    ██    ██ ██   ██ ██   ██ ██   ██ ██ ███ ██
██   ██ ██   ████    ██    ██ ██████  ██   ██ ██   ██  ███ ███
```

**Stop drawing. Start describing.**

Antidraw is a vibe-designing tool that runs on your machine instead of somewhere in the cloud. A Figma-like canvas where every frame is real React code you can hand off to your developer immediately.

## Status

Early alpha. macOS only — Apple Silicon (`arm64`) and Intel (`x64`) builds are signed and notarized.

## Install

Download the matching `.dmg` for your Mac from [Releases](https://github.com/AntidrawHQ/antidraw/releases) and drag Antidraw to `/Applications`. The app is signed and notarized, so first launch works without any Gatekeeper workarounds.

Updates are delivered automatically via `electron-updater` from the GitHub Releases feed.

## Development

Requires Node 20+ and npm.

```sh
git clone https://github.com/AntidrawHQ/antidraw
cd antidraw
npm install
npm run dev:shell
```

That launches the Electron shell in dev mode with HMR. To produce an installable build:

```sh
npm run build:unpack -w @antidraw/shell    # unpacked .app at packages/shell/release/<version>/mac-<arch>/
npm run build:mac    -w @antidraw/shell    # full DMG (host arch)
```

Releases are cut by pushing a `v*.*.*` tag — the workflow in `.github/workflows/release.yml` builds, signs, and notarizes both arches, then uploads a draft release. Promote the draft to "published" when ready; `electron-updater` only picks up published releases.

## Project layout

```
packages/
  shell/              Electron app (main + preload + renderer)
  create-workspace/   `npm create @antidrawapp/create-workspace` scaffolder
  plugin-runtime/     Runtime imported by user workspaces
```

The shell is the actual app. `create-workspace` and `plugin-runtime` are the npm packages users consume from their own design workspaces.

## License

[MIT](LICENSE).
