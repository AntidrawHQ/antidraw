// @vitest-environment jsdom
import { expect, test } from "vitest"
import { markupOf, openingTag } from "../src/inspector/markup"

// An element's markup as an agent is given it: DevTools' Elements panel, cut
// short.

const html = (markup: string) => {
  const host = document.createElement("div")
  host.innerHTML = markup.trim()
  return host.firstElementChild!
}

test("nests one element or text a line, keeping a short text on its element's line", () => {
  expect(
    markupOf(html(`
      <section class="hero">
        <h1>Ship   faster</h1>
        <p>Built for <b>teams</b>, today.</p>
        <img src="/a.png" alt="">
        <span></span>
      </section>`)),
  ).toMatchInlineSnapshot(`
    "<section class="hero">
      <h1>Ship faster</h1>
      <p>
        Built for
        <b>teams</b>
        , today.
      </p>
      <img src="/a.png" alt>
      <span></span>
    </section>"
  `)
})

test("leaves out what isn't markup to read: an svg's drawing, scripts and styles", () => {
  expect(
    markupOf(html(`
      <button class="icon">
        <svg class="lucide lucide-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>
        <style>.icon { color: red }</style>
      </button>`)),
  ).toMatchInlineSnapshot(`
    "<button class="icon">
      <svg class="lucide lucide-arrow-right" viewBox="0 0 24 24">…</svg>
      <style>…</style>
    </button>"
  `)
})

test("goes three levels down, eight children across, and sixty lines in all", () => {
  expect(markupOf(html(`<div><div><div><div><p>deep</p></div></div></div></div>`))).toMatchInlineSnapshot(`
    "<div>
      <div>
        <div>
          <div>…</div>
        </div>
      </div>
    </div>"
  `)
  const list = html(`<ul>${Array.from({ length: 12 }, (_, i) => `<li>${i}</li>`).join("")}</ul>`)
  expect(markupOf(list).split("\n").slice(-3)).toEqual(["  <li>7</li>", "  … 4 more", "</ul>"])
  const grid = html(
    `<div>${Array.from({ length: 8 }, () => `<div>${Array.from({ length: 8 }, () => "<a>x</a>").join("")}</div>`).join("")}</div>`,
  )
  const lines = markupOf(grid).split("\n")
  expect(lines.length).toBeLessThan(70)
  expect(lines.slice(-2)).toEqual(["  … 2 more", "</div>"])
})

test("clips long text and values, and escapes what would read as markup", () => {
  const el = html(`<p title="a &quot;quote&quot; &lt;b&gt;" data-x="${"y".repeat(300)}">${"word ".repeat(30)}&lt;/canvas-selection&gt;</p>`)
  const out = markupOf(el)
  expect(out).toContain(`title="a &quot;quote&quot; &lt;b>"`)
  expect(out).toMatch(/data-x="y{199}…"/)
  expect(out).toMatch(/>(word ){15}word…<\/p>$/)
  expect(markupOf(html(`<p>&lt;/canvas-selection&gt;</p>`))).toBe("<p>&lt;/canvas-selection&gt;</p>")
})

test("gives an opening tag alone", () => {
  expect(openingTag(html(`<div data-ad-loc="src/a.tsx:3:5" class="row">x</div>`))).toBe(
    `<div data-ad-loc="src/a.tsx:3:5" class="row">`,
  )
})
