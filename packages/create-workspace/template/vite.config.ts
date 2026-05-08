import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { antidraw } from "@antidrawapp/runtime/plugin"

export default defineConfig({
  plugins: [react(), tailwindcss(), ...antidraw()],
})
