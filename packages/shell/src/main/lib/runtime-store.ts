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

export const runtimeStore = new Store<RuntimeStoreSchema>({
  name: "runtime",
  defaults: {
    devServers: {},
  },
});

export const devServerStore = {
  get(workspaceId: string): DevServerState | undefined {
    const servers = runtimeStore.get("devServers");
    return servers[workspaceId];
  },

  set(state: DevServerState): void {
    const servers = runtimeStore.get("devServers");
    servers[state.workspaceId] = state;
    runtimeStore.set("devServers", servers);
  },

  remove(workspaceId: string): void {
    const servers = runtimeStore.get("devServers");
    delete servers[workspaceId];
    runtimeStore.set("devServers", servers);
  },

  getAll(): DevServerState[] {
    const servers = runtimeStore.get("devServers");
    return Object.values(servers);
  },

  clear(): void {
    runtimeStore.set("devServers", {});
  },
};
