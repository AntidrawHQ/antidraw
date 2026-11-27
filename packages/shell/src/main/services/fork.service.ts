import { net } from "electron";
import fs from "node:fs/promises";
import { getWorkspacePath, getWorkspaceSourcePath, getWorkspacesPath } from "@/main/api/init";
import { workspaces, type Workspace } from "@/main/api/models/workspace.model";
import { saveFrameLayouts } from "@/main/api/services/frame-layout.service";
import { db } from "@/main/db";
import { npmInstall } from "@/main/lib/package-manager";
import { cloudFetch } from "@/main/services/account.service";
import { forkSite, type ForkEvent } from "@/main/services/fork";

// A fork of one of the account's published sites, as a new workspace on this
// Mac (fork.ts), with the app's server, disk and database.

export type ForkWorkspaceEvent = ForkEvent<Workspace>;

export async function* forkPublishedSite(siteId: string): AsyncGenerator<ForkWorkspaceEvent> {
  const id = crypto.randomUUID();
  await fs.mkdir(getWorkspacesPath(), { recursive: true });
  yield* forkSite<Workspace>({
    siteId,
    workspaceDir: getWorkspacePath(id),
    sourceDir: getWorkspaceSourcePath(id),
    // cloudFetch as fetch, as a publish has it: signed out is the server's
    // 401, unreachable is a network error.
    request: async (pathname, init) => {
      const response = await cloudFetch(pathname, init);
      if (response.isOk()) return response.value;
      if (response.error.code === "SIGNED_OUT") return new Response(null, { status: 401 });
      throw new TypeError(response.error.message);
    },
    // Over net.fetch, as the app's other requests go (the system's proxy and
    // certificates). No cookies, and the repo's token stays with its host.
    fetch: (url, init) => net.fetch(String(url), { ...init, credentials: "omit", redirect: "error" }),
    npmInstall,
    save: async ({ name, siteId, version, layouts }) => {
      const [workspace] = await db
        .insert(workspaces)
        .values({ id, name, forkedFromSiteId: siteId, forkedFromVersion: version })
        .returning();
      // Without them the canvas lays the frames out itself.
      await saveFrameLayouts(id, layouts);
      return workspace!;
    },
  });
}
