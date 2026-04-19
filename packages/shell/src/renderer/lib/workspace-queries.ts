import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { listWorkspaces } from "./api";

export const workspacesQueryOptions = queryOptions({
  queryKey: queryKeys.workspaces.all,
  queryFn: async () => {
    const result = await listWorkspaces();
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  },
});
