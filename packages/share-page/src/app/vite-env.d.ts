/// <reference types="vite/client" />

interface ImportMetaEnv {
  // A site's base URL, * being its slug. Defaults in main.tsx.
  readonly VITE_SITE_URL_PATTERN?: string;
}
