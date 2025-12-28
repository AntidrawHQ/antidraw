import { useQuery } from "@tanstack/react-query";

export const useUserComponents = (projectId: string) => {
  return useQuery({
    queryKey: ["userComponents", projectId],
    queryFn: async () => {
      // Simulate fetching user components

      const viteDevServerUrl = "http://localhost:5174";

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
  });
};
