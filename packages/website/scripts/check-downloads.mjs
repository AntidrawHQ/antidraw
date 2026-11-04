// Run before a deploy: the site's download links (releases/latest/download/Antidraw-<arch>.dmg) must serve a
// file. They 404 until a release built with electron-builder.yml's versionless dmg.artifactName is published.
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/components/user-components/landing/DownloadButton.tsx", import.meta.url), "utf8")
const latest = src.match(/const LATEST = "([^"]+)"/)?.[1]
const files = [...src.matchAll(/\$\{LATEST\}\/([\w.-]+)/g)].map((m) => m[1])
if (!latest || files.length === 0) {
  console.error("check-downloads: couldn't find the download links in DownloadButton.tsx")
  process.exit(1)
}

let failed = false
for (const file of files) {
  const url = `${latest}/${file}`
  const res = await fetch(url, { method: "HEAD", redirect: "follow" }).catch((e) => ({ ok: false, status: String(e) }))
  console.log(`${res.ok ? "ok  " : "FAIL"} ${res.status} ${url}`)
  failed ||= !res.ok
}
if (failed) {
  console.error("\nA download link doesn't resolve. Publish a release with the versionless DMG names first, then deploy.")
  process.exit(1)
}
