import { queryOptions } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { getClaudeAuthStatus } from "./api";

export type { ClaudeAuthStatus } from "@/main/api";

export const claudeCodeAuthQueryOptions = queryOptions({
  queryKey: queryKeys.claudeCode.authStatus,
  queryFn: async () => {
    const result = await getClaudeAuthStatus();
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  },
  staleTime: 30_000,
  retry: false,
});
