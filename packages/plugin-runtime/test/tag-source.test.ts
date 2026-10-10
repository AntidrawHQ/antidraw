import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { createServer, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { antidraw } from "@antidrawapp/runtime/plugin"

// The dev server stamps each element in the workspace's JSX with where it is
// written, for the canvas's inspector: a DOM element's location (data-ad-loc),
// a component's use (data-ad-use).

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "fixture")

const tagSource = () => {
  const plugin = antidraw().find((p) => p.name === "antidraw:tag-source") as Plugin & {
    configResolved: (config: { root: string }) => void
    transform: { handler: (code: string, id: string) => { code: string } | null }
  }
  plugin.configResolved({ root: fixture })
  return (code: string, file: string) => plugin.transform.handler(code, path.join(fixture, file))?.code ?? null
}

test("stamps DOM elements with where they're written, components with where they're used, and fragments not at all", () => {
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
      <Button data-ad-use="kept" />
      {items.map((_, i) => <li key={i}>{String(i)}</li>)}
      <>text</>
      <React.Fragment key="a"><Fragment /></React.Fragment>
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
          <Button data-ad-use={"src/components/user-components/List.tsx:8:7"} />
          <motion.div<{ a: 1 }> data-ad-loc={"src/components/user-components/List.tsx:9:7"} />
          <li data-ad-loc="kept" />
          <Button data-ad-use="kept" />
          {items.map((_, i) => <li data-ad-loc={"src/components/user-components/List.tsx:12:28"} key={i}>{String(i)}</li>)}
          <>text</>
          <React.Fragment key="a"><Fragment /></React.Fragment>
        </ul>
      )
    }
    "
  `)
})

test("counts lines as editors do: only \\n ends one, and a byte order mark isn't a column", () => {
  const transform = tagSource()
  // Shown with the characters editors don't break a line at made visible.
  const visible = (code: string | null) =>
    code!.replace(/\u2028/g, "<LS>").replace(/\u2029/g, "<PS>").replace(/\r(?!\n)/g, "<CR>").replace(/\ufeff/g, "<BOM>")
  const file = "src/components/user-components/A.tsx"
  // U+2028 and U+2029 in pasted text, a lone \r: one line each, to an editor.
  expect(
    visible(transform("// one\u2028two\u2029three\rfour\nexport default () => <p>a\u2028b <span/></p>\n", file)),
  ).toMatchInlineSnapshot(`
    "// one<LS>two<PS>three<CR>four
    export default () => <p data-ad-loc={"src/components/user-components/A.tsx:2:22"}>a<LS>b <span data-ad-loc={"src/components/user-components/A.tsx:2:29"}/></p>
    "
  `)
  expect(visible(transform("\ufeffexport default () => <div/>\r\n", file))).toMatchInlineSnapshot(`
    "<BOM>export default () => <div data-ad-loc={"src/components/user-components/A.tsx:1:22"}/>
    "
  `)
})

test("skips files that aren't JSX, aren't the workspace's, or don't parse", () => {
  const transform = tagSource()
  expect(transform(`export const a = <div />`, "src/lib/a.ts")).toBeNull()
  expect(transform(`export const A = () => <div />`, "node_modules/pkg/A.tsx")).toBeNull()
  expect(transform(`export const A = () => <div`, "src/components/user-components/A.tsx")).toBeNull()
  expect(transform(`export const A = () => <Fragment><React.Fragment /></Fragment>`, "src/components/user-components/A.tsx")).toBeNull()
  // Fragment under another name is still Fragment, which takes no props.
  expect(
    transform(`import { Fragment as F } from "react"\nexport const A = () => <F><F /></F>`, "src/components/user-components/A.tsx"),
  ).toBeNull()
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
    // Stamped before plugin-react reprints the file, though it's listed first.
    const shifted = await server.transformRequest("/src/lib/Shifted.tsx")
    const source = fs.readFileSync(path.join(fixture, "src/lib/Shifted.tsx"), "utf8").split("\n")
    expect(
      [...shifted!.code.matchAll(/"data-ad-loc": "src\/lib\/Shifted\.tsx:(\d+):(\d+)"/g)].map(([, line, column]) =>
        source[Number(line) - 1]!.slice(Number(column) - 1, Number(column) + 7),
      ),
    ).toMatchInlineSnapshot(`
      [
        "<div>",
        "<p>first",
        "<br/>sec",
        "<b>bold<",
        "<input d",
        "<label>n",
        "<i data-",
        "<span>af",
        "<em>yes<",
        "<s>no</s",
      ]
    `)
  } finally {
    await server.close()
  }
})
