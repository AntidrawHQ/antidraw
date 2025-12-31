import { defineConfig } from "vite"
import { antidraw } from "@antidrawapp/runtime/plugin"

export default defineConfig({
  plugins: [...antidraw()],
})
