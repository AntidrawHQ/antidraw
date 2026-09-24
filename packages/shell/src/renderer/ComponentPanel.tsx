import { useWorkspaceStore } from "./store/workspace";
import { useUserComponents } from "./store/userComponents";
import { ComponentList } from "./canvas/ComponentList";

export const ComponentPanel = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);

  const {
    data: components,
    isPending,
    isError,
  } = useUserComponents(activeWorkspaceId);

  return (
    <ComponentList
      components={components ?? []}
      onSelect={setFocusComponentName}
      message={
        isPending
          ? "Loading components..."
          : isError || !components
            ? "Failed to load components"
            : undefined
      }
    />
  );
};
