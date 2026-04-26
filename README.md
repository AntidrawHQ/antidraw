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

`v0.0.1-alpha` — early. macOS Apple Silicon only. Not signed yet, so first launch needs the workaround below.

## Install

Download the latest `.dmg` from [Releases](https://github.com/AntidrawHQ/antidraw/releases) and drag Antidraw to `/Applications`.

Because the build is unsigned, macOS Gatekeeper will refuse to launch it on first try. Run this once in Terminal to clear the quarantine flag:

```sh
xattr -cr /Applications/Antidraw.app
```

Code signing + notarization is on the roadmap; this step goes away once we sign.

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
npm run build:unpack -w @antidraw/shell    # unpacked .app at packages/shell/release/<version>/mac-arm64/
npm run build:mac    -w @antidraw/shell    # full DMG
```

## Project layout

```
packages/
  shell/              Electron app (main + preload + renderer)
  create-workspace/   `npm create @antidrawapp/create-workspace` scaffolder
  plugin-runtime/     Runtime imported by user workspaces
```

The shell is the actual app. `create-workspace` and `plugin-runtime` are the npm packages users consume from their own design workspaces.

## License

The Antidraw application (everything under `packages/shell`) is licensed under [AGPL-3.0-or-later](LICENSE). If you fork it or run a modified version as a network service, you have to share your changes under the same license.

The packages users embed into their own projects — `@antidrawapp/create-workspace` and `@antidrawapp/runtime` — are MIT-licensed so they don't infect user code.
