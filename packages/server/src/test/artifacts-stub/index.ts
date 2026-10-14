import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

// The Artifacts binding for tests (wrangler.jsonc's `test` environment binds
// ARTIFACTS to this Worker), since Artifacts has no local mode. It keeps repos
// in memory and speaks no git: a test says what was pushed with `pushed()`.
// Errors carry only a message, as the real ones do once they've crossed RPC.
// Tests drive it through the harness (TestServer.artifacts).

type Repo = { commits: Set<string>; tokens: Map<string, "active" | "revoked"> };

const repos = new Map<string, Repo>();
const creating = new Map<string, number>();
let calls: string[] = [];
let failing = false;

const call = (description: string) => {
  calls.push(description);
  if (failing) throw new Error("internal error");
};

class RepoHandle extends RpcTarget {
  constructor(private readonly name: string) {
    super();
  }

  info() {
    call(`info ${this.name}`);
    return { name: this.name, remote: `https://artifacts.test/git/sites/${this.name}.git`, defaultBranch: "main" };
  }

  createToken(scope: "read" | "write", ttl: number) {
    call(`createToken ${this.name} ${scope} ${ttl}`);
    const { tokens } = repos.get(this.name)!;
    const id = `token-${tokens.size + 1}`;
    tokens.set(id, "active");
    return { id, plaintext: `art_test_${scope}?expires=1893456000`, scope, expiresAt: "2030-01-01T00:00:00.000Z" };
  }

  listTokens() {
    call(`listTokens ${this.name}`);
    const tokens = [...repos.get(this.name)!.tokens].map(([id, state]) => ({
      id,
      scope: "write",
      state,
      createdAt: "2029-12-31T23:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }));
    return { tokens, total: tokens.length };
  }

  revokeToken(tokenOrId: string) {
    call(`revokeToken ${this.name} ${tokenOrId}`);
    const { tokens } = repos.get(this.name)!;
    if (tokens.get(tokenOrId) !== "active") return false;
    tokens.set(tokenOrId, "revoked");
    return true;
  }

  readCommit(hash: string) {
    call(`readCommit ${this.name} ${hash}`);
    return repos.get(this.name)!.commits.has(hash) ? { hash } : null;
  }
}

export default class ArtifactsStub extends WorkerEntrypoint {
  // The binding's surface (src/lib/artifacts.ts).

  create(name: string, opts?: { setDefaultBranch?: string }) {
    call(`create ${name} ${JSON.stringify(opts ?? {})}`);
    if (repos.has(name)) throw new Error(`repo already exists: ${name}`);
    repos.set(name, { commits: new Set(), tokens: new Map() });
    return { name, remote: `https://artifacts.test/git/sites/${name}.git` };
  }

  get(name: string) {
    call(`get ${name}`);
    if (!repos.has(name)) throw new Error(`Repository not found: ${name}.`);
    const left = creating.get(name) ?? 0;
    if (left > 0) {
      creating.set(name, left - 1);
      throw new Error(`Repository is still being created: ${name}.`);
    }
    return new RepoHandle(name);
  }

  // For tests.

  /** As if a push to the repo had added the commit. */
  pushed(name: string, commit: string) {
    repos.get(name)!.commits.add(commit);
  }

  /** Makes the repo's next `times` gets answer that it's still being created. */
  setCreating(name: string, times: number) {
    creating.set(name, times);
  }

  /** The repo's tokens and whether each is still live, by id. */
  tokens(name: string) {
    return Object.fromEntries(repos.get(name)!.tokens);
  }

  /** The calls made since the last time, oldest first. */
  takeCalls() {
    const taken = calls;
    calls = [];
    return taken;
  }

  /** Makes every call throw, as when Artifacts is down. */
  setFailing(value: boolean) {
    failing = value;
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}
