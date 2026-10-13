// @vitest-environment jsdom
import { expect, test } from "vitest"
import { markupOf, openingTag } from "../markup"

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

test("gives what a form holds as it is on screen, but a secret's value", () => {
  const form = html(`<form>
    <input name="email" value="first">
    <input type="password" value="hunter2">
    <input type="hidden" name="csrf" value="tok_SECRET">
    <input autocomplete="cc-number" value="4111111111111111">
    <input autocomplete="section-pay billing CC-CSC" value="123">
    <select><option value="a" selected>A</option><option value="b">B</option></select>
    <textarea>first draft</textarea>
  </form>`)
  // Typed since, as React's controlled fields are: the properties change,
  // the attributes don't.
  form.querySelector<HTMLInputElement>('[name="email"]')!.value = "now@example.com"
  form.querySelector<HTMLInputElement>('[type="password"]')!.value = "hunter3"
  form.querySelector("select")!.value = "b"
  form.querySelector("textarea")!.value = "second draft"
  expect(markupOf(form)).toMatchInlineSnapshot(`
    "<form>
      <input name="email" value="now@example.com">
      <input type="password">
      <input type="hidden" name="csrf">
      <input autocomplete="cc-number">
      <input autocomplete="section-pay billing CC-CSC">
      <select>
        <option value="a">A</option>
        <option value="b" selected>B</option>
      </select>
      <textarea>second draft</textarea>
    </form>"
  `)
})

test("leaves out an element of the inspector's own", () => {
  const dialog = html(`<dialog><button>Delete</button><antidraw-agent></antidraw-agent></dialog>`)
  expect(markupOf(dialog, (el) => el.localName === "antidraw-agent")).toBe("<dialog>\n  <button>Delete</button>\n</dialog>")
})
