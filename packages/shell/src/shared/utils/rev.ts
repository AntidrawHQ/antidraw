// A value as a short token, which changes when the value does. What reads
// something and acts on it later (an outside agent, main/mcp) hands the
// token back, to say which state it read: an edit and a comment keep their
// ids while the user goes on changing them.
export const revOf = (value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
};
