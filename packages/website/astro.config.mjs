// @ts-check
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://antidraw.com",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // The landing's components come from an Antidraw workspace, which imports by "@/".
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  },
});
