export type FuzzyMatchResult = {
  match: boolean;
  indices: number[];
};

/**
 * Simple subsequence fuzzy matching.
 * Returns whether the query matches and which character indices matched.
 *
 * Example: fuzzyMatch("Design System", "ds")
 * → { match: true, indices: [0, 7] }
 */
export const fuzzyMatch = (text: string, query: string): FuzzyMatchResult => {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const indices: number[] = [];

  let queryIdx = 0;
  for (let i = 0; i < text.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      indices.push(i);
      queryIdx++;
    }
  }

  return { match: queryIdx === queryLower.length, indices };
};
