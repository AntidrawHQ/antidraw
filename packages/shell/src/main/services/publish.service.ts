import { net } from "electron";
import { eq } from "drizzle-orm";
import { err, type Result } from "neverthrow";
import path from "node:path";
import { getWorkspacePath, getWorkspaceSourcePath } from "@/main/api/init";
import { workspaces } from "@/main/api/models/workspace.model";
import { listComponents } from "@/main/api/services/component.service";
import { getFrameLayouts } from "@/main/api/services/frame-layout.service";
import { getWorkspace } from "@/main/api/services/workspace.service";
import { db } from "@/main/db";
import { spawnNpm } from "@/main/lib/package-manager";
import { cloudFetch } from "@/main/services/account.service";
import { publishSite, type PublishError, type PublishEvent } from "@/main/services/publish";
import { artifactsRemote } from "@/main/services/source";

type PublishWorkspaceError =
  | PublishError
  | { status: 404 | 500; code: string; message: string }
  | { status: 502; code: "SERVER_UNREACHABLE" | "SERVER_ERROR"; message: string };

export type { PublishEvent };

type Publish = {
  result: Promise<Result<{ url: string }, PublishWorkspaceError>>;
  /** What it has said so far, for whoever joins late. */
  events: PublishEvent[];
  listeners: Set<(event: PublishEvent) => void>;
};

// One publish per workspace at a time; a second click joins the first, and
// hears what it has said so far before what it says next.
const running = new Map<string, Publish>();

export const publishWorkspace = (workspaceId: string, onEvent?: (event: PublishEvent) => void) => {
  let publish = running.get(workspaceId);
  if (!publish) {
    const events: PublishEvent[] = [];
    const listeners = new Set<(event: PublishEvent) => void>();
    const emit = (event: PublishEvent) => {
      events.push(event);
      listeners.forEach((listener) => listener(event));
    };
    publish = { result: run(workspaceId, emit).finally(() => running.delete(workspaceId)), events, listeners };
    running.set(workspaceId, publish);
  }
  if (onEvent) {
    publish.events.forEach(onEvent);
    publish.listeners.add(onEvent);
    const { listeners } = publish;
    void publish.result.finally(() => listeners.delete(onEvent)).catch(() => {});
  }
  return publish.result;
};

const run = async (
  workspaceId: string,
  onEvent: (event: PublishEvent) => void,
): Promise<Result<{ url: string }, PublishWorkspaceError>> => {
  const workspace = await getWorkspace(workspaceId);
  if (workspace.isErr()) return err(workspace.error);
  const components = await listComponents(workspaceId);
  if (components.isErr()) return err(components.error);
  const layouts = await getFrameLayouts(workspaceId);
  if (layouts.isErr()) return err(layouts.error);

  const { name, siteId, siteUrl } = workspace.value;
  const gitDir = path.join(getWorkspacePath(workspaceId), "publish.git");
  const published = await publishSite({
    sourceDir: getWorkspaceSourcePath(workspaceId),
    gitDir,
    // Over net.fetch, as the app's requests to the Worker go: the system's
    // proxy and certificates (see account.service.ts), and no time limit
    // on a slow push. No cookies, and the token stays with the repo's host.
    sourceRemote: ({ remote, token }) =>
      artifactsRemote({
        gitDir,
        url: remote,
        token,
        fetch: (url, init) => net.fetch(String(url), { ...init, credentials: "omit", redirect: "error" }),
      }),
    canvas: {
      version: 1,
      name,
      components: components.value,
      layouts: layouts.value.map(({ componentName, x, y, width, height }) => ({ componentName, x, y, width, height })),
    },
    site: siteId && siteUrl ? { id: siteId, url: siteUrl } : null,
    // cloudFetch as fetch: signed out is the server's 401 (the token is
    // already dropped), unreachable is a network error.
    request: async (url, init) => {
      const response = await cloudFetch(url, init);
      if (response.isOk()) return response.value;
      if (response.error.code === "SIGNED_OUT") return new Response(null, { status: 401 });
      throw new TypeError(response.error.message);
    },
    npm: spawnNpm,
    onSiteCreated: async (site) => {
      await db.update(workspaces).set({ siteId: site.id, siteUrl: site.url }).where(eq(workspaces.id, workspaceId));
    },
    onEvent,
  });
  if (published.isOk()) {
    await db.update(workspaces).set({ publishedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  }
  return published;
};
