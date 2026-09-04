import Store from "electron-store";

export type DevServerState = {
  workspaceId: string;
  pid: number;
  port: number;
  startedAt: number;
};

type RuntimeStoreSchema = {
  devServers: Record<string, DevServerState>;
};

// Constructed lazily: electron-store needs a live Electron `app` for its
// default cwd, and merely importing this module must not require one (the
// API layer is importable under plain node, e.g. in tests).
let store: Store<RuntimeStoreSchema> | null = null;
const runtimeStore = (): Store<RuntimeStoreSchema> => {
  store ??= new Store<RuntimeStoreSchema>({
    name: "runtime",
    defaults: {
      devServers: {},
    },
  });
  return store;
};

export const devServerStore = {
  get(workspaceId: string): DevServerState | undefined {
    const servers = runtimeStore().get("devServers");
    return servers[workspaceId];
  },

  set(state: DevServerState): void {
    const servers = runtimeStore().get("devServers");
    servers[state.workspaceId] = state;
    runtimeStore().set("devServers", servers);
  },

  remove(workspaceId: string): void {
    const servers = runtimeStore().get("devServers");
    delete servers[workspaceId];
    runtimeStore().set("devServers", servers);
  },

  getAll(): DevServerState[] {
    const servers = runtimeStore().get("devServers");
    return Object.values(servers);
  },

  clear(): void {
    runtimeStore().set("devServers", {});
  },
};
