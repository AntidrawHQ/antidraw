// A workspace dev server's preview page, where a frame shows a component:
// https://localhost:<port>/preview?componentName=Card.
export const isPreviewUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "localhost" && u.pathname === "/preview";
  } catch {
    return false;
  }
};
