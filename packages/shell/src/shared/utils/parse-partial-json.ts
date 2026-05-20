import { fixJson } from "./fix-json";

export const parsePartialJson = (
  text: string,
): Record<string, unknown> | undefined => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }
  try {
    return JSON.parse(fixJson(text));
  } catch {
    // ignore
  }
  return undefined;
};
