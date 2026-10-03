// A component name is one file-name segment: the source route appends ".tsx"
// and reads it from src/components/user-components/, as the runtime's Preview
// page does when it loads one. Anything that could leave that directory is
// rejected; everything else a file name can hold is allowed, so any component
// that previews can also be opened. The runtime's Preview.tsx carries the
// same rule (plus the URL delimiters it cannot request); keep them in step.
export const isComponentName = (name: string) =>
  name.length > 0 && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
