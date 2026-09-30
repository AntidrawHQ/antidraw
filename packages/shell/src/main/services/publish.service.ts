import { eq } from "drizzle-orm";
import { err, type Result } from "neverthrow";
import { getWorkspaceSourcePath } from "@/main/api/init";
import { workspaces } from "@/main/api/models/workspace.model";
import { listComponents } from "@/main/api/services/component.service";
import { getFrameLayouts } from "@/main/api/services/frame-layout.service";
import { getWorkspace } from "@/main/api/services/workspace.service";
import { db } from "@/main/db";
import { spawnNpm } from "@/main/lib/package-manager";
import { cloudFetch } from "@/main/services/account.service";
import { publishSite, type PublishError } from "@/main/services/publish";

type PublishWorkspaceError =
  | PublishError
  | { status: 404 | 500; code: string; message: string }
  | { status: 502; code: "SERVER_UNREACHABLE" | "SERVER_ERROR"; message: string };

// One publish per workspace at a time; a second click joins the first.
const running = new Map<string, Promise<Result<{ url: string }, PublishWorkspaceError>>>();

export const publishWorkspace = (workspaceId: string) => {
  let publish = running.get(workspaceId);
  if (!publish) {
    publish = run(workspaceId).finally(() => running.delete(workspaceId));
    running.set(workspaceId, publish);
  }
  return publish;
};

const run = async (workspaceId: string): Promise<Result<{ url: string }, PublishWorkspaceError>> => {
  const workspace = await getWorkspace(workspaceId);
  if (workspace.isErr()) return err(workspace.error);
  const components = await listComponents(workspaceId);
  if (components.isErr()) return err(components.error);
  const layouts = await getFrameLayouts(workspaceId);
  if (layouts.isErr()) return err(layouts.error);

  const { name, siteId, siteUrl } = workspace.value;
  return publishSite({
    sourceDir: getWorkspaceSourcePath(workspaceId),
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
  });
};
