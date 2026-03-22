import { useQuery, skipToken } from "@tanstack/react-query";
import { useDevServerStatus } from "@/renderer/lib/workspace-ops";
import { queryKeys } from "@/renderer/lib/query-keys";

export const useUserComponents = (workspaceId: string | null) => {
  const { data: devServer } = useDevServerStatus(workspaceId);
  const port = devServer?.port ?? null;

  return useQuery({
    queryKey: queryKeys.userComponents.byWorkspace(workspaceId!, port!),
    queryFn:
      workspaceId && port
        ? async () => {
            const viteDevServerUrl = `https://localhost:${port}`;

            const response = await fetch(`${viteDevServerUrl}/__components`);

            if (!response.ok) {
              throw new Error("Failed to fetch user components");
            }

            const components = (await response.json()) as {
              components: Array<{
                name: string;
              }>;
            };

            return components.components;
          }
        : skipToken,
  });
};
