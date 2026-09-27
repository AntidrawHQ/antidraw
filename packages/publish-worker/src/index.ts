// The publish Worker's entry point: one handler, with one pointer cache per
// isolate. What it serves, and how, is serve.ts. The entry module exports the
// handler only (workerd takes every export of it for a handler).

import { createWorker } from "./serve";

export type { Env } from "./serve";

export default createWorker();
