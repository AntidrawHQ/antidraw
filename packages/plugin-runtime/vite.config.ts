import { defineConfig } from "vite"
import { designsette } from "./plugin"

export default defineConfig({
  plugins: [designsette()],
})
