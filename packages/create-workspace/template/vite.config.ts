import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { antidraw } from "@antidrawapp/runtime/plugin"

export default defineConfig({
  // antidraw() must come before react(): its source tagging needs original
  // column positions, which plugin-react's retainLines Babel pass discards
  plugins: [...antidraw(), react(), tailwindcss()],
})
