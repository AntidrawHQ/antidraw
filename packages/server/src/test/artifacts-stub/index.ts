import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

// The Artifacts binding for tests (wrangler.jsonc's `test` environment binds
// ARTIFACTS to this Worker), since Artifacts has no local mode. It keeps repos
// in memory and speaks no git: a test says what was pushed with `pushed()`.
// Errors carry only a message, as the real ones do once they've crossed RPC.
// Tests drive it through the harness (TestServer.artifacts).

type Repo = { commits: Set<string> };

const repos = new Map<string, Repo>();
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
    return { plaintext: `art_test_${scope}?expires=1893456000`, expiresAt: "2030-01-01T00:00:00.000Z" };
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
    repos.set(name, { commits: new Set() });
    return { name, remote: `https://artifacts.test/git/sites/${name}.git` };
  }

  get(name: string) {
    call(`get ${name}`);
    if (!repos.has(name)) throw new Error(`Repository not found: ${name}.`);
    return new RepoHandle(name);
  }

  // For tests.

  /** As if a push to the repo had added the commit. */
  pushed(name: string, commit: string) {
    repos.get(name)!.commits.add(commit);
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
