const modules = import.meta.glob("./*.tsx", { eager: true })

export const userComponents = Object.fromEntries(
  Object.entries(modules)
    .filter(([path]) => !path.includes("index"))
    .map(([path, mod]) => [
      path.replace("./", "").replace(".tsx", ""),
      (mod as { default: React.ComponentType }).default,
    ])
)
