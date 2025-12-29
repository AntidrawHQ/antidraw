import { createFileRoute } from "@tanstack/react-router";
import { userComponents } from "./../user-components";
import { createElement, useEffect, useRef } from "react";

type PreviewSearchParams = {
  componentName?: string;
};

const ComponentPreview = () => {
  const { componentName } = Route.useSearch();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && componentName) {
      window.parent.postMessage(
        {
          type: "component-size",
          componentName,
          width: containerRef.current.scrollWidth,
          height: containerRef.current.scrollHeight,
        },
        "*"
      );
    }
  }, []);

  if (!componentName) {
    return <h1>Nothing to preview</h1>;
  }

  if (!(componentName in userComponents)) {
    return <h1>Component not found</h1>;
  }

  const componentToPreview =
    userComponents[componentName as keyof typeof userComponents];

  return (
    <div ref={containerRef} style={{ display: "inline-block" }}>
      {createElement(componentToPreview)}
    </div>
  );
};

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, string>): PreviewSearchParams => {
    const componentName = search.componentName || undefined;

    return { componentName };
  },
  component: ComponentPreview,
});
