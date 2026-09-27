import { describe, expect, it } from "vitest";
import { contentType } from "./content-type";
import { ifNoneMatchHits, ifRangeAllows, parseRange } from "./http-conditions";

const table = <T>(inputs: string[], fn: (input: string) => T) =>
  Object.fromEntries(inputs.map((input) => [input, fn(input)]));

describe("parseRange", () => {
  it("parses single ranges against a 100-byte file", () => {
    expect(
      table(
        [
          "bytes=0-9",
          "bytes=10-",
          "bytes=-5",
          "bytes=-500",
          "bytes=90-500",
          "bytes=99-99",
          "BYTES = 0 - 1",
          "bytes=0-99999999999999999999",
          "bytes=100-",
          "bytes=100-200",
          "bytes=-0",
          "bytes=99999999999999999999-",
          "bytes=5-1",
          "bytes=0-1,5-6",
          "items=0-1",
          "bytes=-",
          "bytes=a-b",
          "bytes 0-1",
          "",
          "bytes=1.5-2",
        ],
        (header) => parseRange(header, 100),
      ),
    ).toMatchInlineSnapshot(`
      {
        "": null,
        "BYTES = 0 - 1": {
          "end": 1,
          "start": 0,
        },
        "bytes 0-1": null,
        "bytes=-": null,
        "bytes=-0": "unsatisfiable",
        "bytes=-5": {
          "end": 99,
          "start": 95,
        },
        "bytes=-500": {
          "end": 99,
          "start": 0,
        },
        "bytes=0-1,5-6": null,
        "bytes=0-9": {
          "end": 9,
          "start": 0,
        },
        "bytes=0-99999999999999999999": {
          "end": 99,
          "start": 0,
        },
        "bytes=1.5-2": null,
        "bytes=10-": {
          "end": 99,
          "start": 10,
        },
        "bytes=100-": "unsatisfiable",
        "bytes=100-200": "unsatisfiable",
        "bytes=5-1": null,
        "bytes=90-500": {
          "end": 99,
          "start": 90,
        },
        "bytes=99-99": {
          "end": 99,
          "start": 99,
        },
        "bytes=99999999999999999999-": "unsatisfiable",
        "bytes=a-b": null,
        "items=0-1": null,
      }
    `);
  });

  it("finds nothing satisfiable in an empty file", () => {
    expect(table(["bytes=0-", "bytes=-1", "bytes=0-0"], (header) => parseRange(header, 0))).toMatchInlineSnapshot(`
      {
        "bytes=-1": "unsatisfiable",
        "bytes=0-": "unsatisfiable",
        "bytes=0-0": "unsatisfiable",
      }
    `);
  });
});

describe("ifNoneMatchHits", () => {
  it("matches weakly against one or several tags", () => {
    expect(
      table(['"abc"', 'W/"abc"', '"x", "abc"', "*", ' "abc" ', '"x"', "abc", '"abcd"'], (header) =>
        ifNoneMatchHits(header, '"abc"'),
      ),
    ).toMatchInlineSnapshot(`
      {
        " "abc" ": true,
        ""abc"": true,
        ""abcd"": false,
        ""x"": false,
        ""x", "abc"": true,
        "*": true,
        "W/"abc"": true,
        "abc": false,
      }
    `);
    expect(ifNoneMatchHits(null, '"abc"')).toBe(false);
  });
});

describe("ifRangeAllows", () => {
  it("needs a strong exact match", () => {
    expect({
      absent: ifRangeAllows(null, '"abc"'),
      ...table(['"abc"', 'W/"abc"', "Wed, 21 Oct 2015 07:28:00 GMT"], (header) => ifRangeAllows(header, '"abc"')),
    }).toMatchInlineSnapshot(`
      {
        ""abc"": true,
        "W/"abc"": false,
        "Wed, 21 Oct 2015 07:28:00 GMT": false,
        "absent": true,
      }
    `);
  });
});

describe("contentType", () => {
  it("maps extensions case-insensitively, defaulting to octet-stream", () => {
    expect(
      table(
        [
          "index.html",
          "assets/app-1a2b.JS",
          "a/b.css",
          "clip.mp4",
          "font.woff2",
          "icon.svg",
          "data.json",
          "data.unknownext",
          "Makefile",
          ".htaccess",
          "dir.v2/noext",
        ],
        contentType,
      ),
    ).toMatchInlineSnapshot(`
      {
        ".htaccess": "application/octet-stream",
        "Makefile": "application/octet-stream",
        "a/b.css": "text/css; charset=utf-8",
        "assets/app-1a2b.JS": "text/javascript; charset=utf-8",
        "clip.mp4": "video/mp4",
        "data.json": "application/json; charset=utf-8",
        "data.unknownext": "application/octet-stream",
        "dir.v2/noext": "application/octet-stream",
        "font.woff2": "font/woff2",
        "icon.svg": "image/svg+xml",
        "index.html": "text/html; charset=utf-8",
      }
    `);
  });
});
