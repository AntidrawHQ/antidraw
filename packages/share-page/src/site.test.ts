import { expect, it } from "vitest";
import { siteFor, slugFromPath } from "./site";

it("finds the slug in /s/<slug>, and nothing else", () => {
  const paths = ["/s/paper-shaders", "/s/paper-shaders/", "/s/", "/s/a/b", "/s/Caps", "/s/-edge", "/paper-shaders"];
  expect(Object.fromEntries(paths.map((path) => [path, slugFromPath(path)]))).toMatchInlineSnapshot(`
    {
      "/paper-shaders": null,
      "/s/": null,
      "/s/-edge": null,
      "/s/Caps": null,
      "/s/a/b": null,
      "/s/paper-shaders": "paper-shaders",
      "/s/paper-shaders/": "paper-shaders",
    }
  `);
});

it("points at the site's canvas.json and Preview page", () => {
  const urls = (pattern: string) => {
    const site = siteFor(pattern, "paper-shaders");
    return [site.canvasFile, site.frameUrl("Hero Card"), site.frameUrl("a&b/c?")];
  };
  expect({
    production: urls("https://*.antidraw.app"),
    dev: urls("http://*.localhost:8787"),
  }).toMatchInlineSnapshot(`
    {
      "dev": [
        "http://paper-shaders.localhost:8787/canvas.json",
        "http://paper-shaders.localhost:8787/preview?componentName=Hero%20Card",
        "http://paper-shaders.localhost:8787/preview?componentName=a%26b%2Fc%3F",
      ],
      "production": [
        "https://paper-shaders.antidraw.app/canvas.json",
        "https://paper-shaders.antidraw.app/preview?componentName=Hero%20Card",
        "https://paper-shaders.antidraw.app/preview?componentName=a%26b%2Fc%3F",
      ],
    }
  `);
});
