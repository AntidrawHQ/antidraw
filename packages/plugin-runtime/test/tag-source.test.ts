import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { createServer, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { antidraw } from "@antidrawapp/runtime/plugin"

// The dev server stamps each DOM element in the workspace's JSX with where it
// is written (data-ad-loc), for the canvas's inspector.

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "fixture")

const tagSource = () => {
  const plugin = antidraw().find((p) => p.name === "antidraw:tag-source") as Plugin & {
    configResolved: (config: { root: string }) => void
    transform: (code: string, id: string) => { code: string } | null
  }
  plugin.configResolved({ root: fixture })
  return (code: string, file: string) => plugin.transform(code, path.join(fixture, file))?.code ?? null
}

test("stamps DOM elements with file, line and column, and leaves components alone", () => {
  const transform = tagSource()
  const code = `const motion = { div: (props: object) => null }
function Button(props: object) {
  return <button {...props} />
}
export default function List<T>({ items }: { items: T[] }) {
  return (
    <ul className="list">
      <Button />
      <motion.div<{ a: 1 }> />
      <li data-ad-loc="kept" />
      {items.map((_, i) => <li key={i}>{String(i)}</li>)}
      <>text</>
    </ul>
  )
}
`
  expect(transform(code, "src/components/user-components/List.tsx")).toMatchInlineSnapshot(`
    "const motion = { div: (props: object) => null }
    function Button(props: object) {
      return <button data-ad-loc={"src/components/user-components/List.tsx:3:10"} {...props} />
    }
    export default function List<T>({ items }: { items: T[] }) {
      return (
        <ul data-ad-loc={"src/components/user-components/List.tsx:7:5"} className="list">
          <Button />
          <motion.div<{ a: 1 }> data-ad-loc={"src/components/user-components/List.tsx:9:7"} />
          <li data-ad-loc="kept" />
          {items.map((_, i) => <li data-ad-loc={"src/components/user-components/List.tsx:11:28"} key={i}>{String(i)}</li>)}
          <>text</>
        </ul>
      )
    }
    "
  `)
})

test("skips files that aren't JSX, aren't the workspace's, or don't parse", () => {
  const transform = tagSource()
  expect(transform(`export const a = <div />`, "src/lib/a.ts")).toBeNull()
  expect(transform(`export const A = () => <div />`, "node_modules/pkg/A.tsx")).toBeNull()
  expect(transform(`export const A = () => <div`, "src/components/user-components/A.tsx")).toBeNull()
  expect(transform(`export const A = () => <Card />`, "src/components/user-components/A.tsx")).toBeNull()
})

test("is part of the dev server only, after which the element still gets the attribute", async () => {
  expect(
    antidraw().find((p) => p.name === "antidraw:tag-source")?.apply,
  ).toBe("serve")
  const server = await createServer({
    root: fixture,
    configFile: false,
    logLevel: "silent",
    plugins: [react(), ...antidraw()],
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, entries: [] },
  })
  try {
    const card = await server.transformRequest("/src/components/user-components/Card.tsx")
    expect(card?.code).toMatch(/"data-ad-loc": "src\/components\/user-components\/Card\.tsx:2:10"/)
  } finally {
    await server.close()
  }
})
