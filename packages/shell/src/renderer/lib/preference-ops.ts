import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { getPreference } from "./api";

export const usePreference = (key: string) => {
  return useQuery({
    queryKey: queryKeys.preferences.byKey(key),
    queryFn: async () => {
      const result = await getPreference(key);
      if (result.isErr()) throw new Error(result.error.message);
      return result.value;
    },
    staleTime: Infinity,
  });
};
