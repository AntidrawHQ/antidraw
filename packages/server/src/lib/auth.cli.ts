import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";

// Schema-generation-only config for `@better-auth/cli generate`. The CLI runs
// in Node and cannot construct the real getAuth(env) (no Worker env / D1
// binding), but schema generation only reads the plugin list + adapter
// `provider` — never the db. So we hand it a dummy adapter with the same
// plugins. Keep this in sync with src/lib/auth.ts plugins.
//
// Run: npx @better-auth/cli generate --config src/lib/auth.cli.ts \
//        --output src/db/auth.schema.ts --yes
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "sqlite" }),
  socialProviders: {
    google: { clientId: "cli", clientSecret: "cli" },
  },
  plugins: [bearer(), oneTimeToken()],
});
