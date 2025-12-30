import { defineConfig } from "vite"
import { designsette } from "@designsette/runtime/plugin"

export default defineConfig({
  plugins: [...designsette()],
})
