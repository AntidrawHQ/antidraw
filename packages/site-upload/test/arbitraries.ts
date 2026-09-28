import fc from "fast-check";
import { DEFAULT_LIMITS } from "../src/protocol/limits";
import { pathProblem } from "../src/protocol/manifest";

// Characters that sort before "/" (where the clash check's sort trick could
// break), ones URLs treat specially, multi-byte ones, and a combining accent.
const WIDE = ["a", "b", "-", ".", " ", "!", "%", "?", "#", "&", "+", "~", "'", "(", "@", ":", ",", "é", "日", "😀", " ", "́"];
// Few characters and short segments, so generated paths often clash.
const NARROW = ["a", "b", "-", ".", " ", "!"];

const pathFrom = (chars: string[], maxSegment: number) =>
  fc
    .array(fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: maxSegment }), { minLength: 1, maxLength: 3 })
    .map((segments) => segments.map((s) => s.join("")).join("/"))
    .filter((path) => pathProblem(path, DEFAULT_LIMITS.maxPathBytes) === null);

/** Paths parseManifest accepts, drawn from characters likely to cause trouble. */
export const sitePath = pathFrom(WIDE, 4);

/** Paths from a tiny alphabet, so a handful of them often clash. */
export const clashyPath = pathFrom(NARROW, 2);

/** One path is another's folder: "a" and "a/b". The slow, obvious check. */
export const clashes = (paths: string[]) => paths.some((a) => paths.some((b) => b.startsWith(`${a}/`)));
