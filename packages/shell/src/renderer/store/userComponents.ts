import { useQuery } from "@tanstack/react-query";
import { useDevServerStatus } from "@/renderer/lib/workspace-ops";

export const useUserComponents = (workspaceId: string | null) => {
  const { data: devServer } = useDevServerStatus(workspaceId);

  return useQuery({
    queryKey: ["userComponents", workspaceId, devServer?.port],
    queryFn: async () => {
      if (!devServer?.port) {
        throw new Error("Dev server port unavailable");
      }

      const viteDevServerUrl = `http://localhost:${devServer.port}`;

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
    },
    enabled: !!workspaceId && !!devServer?.port,
  });
};
