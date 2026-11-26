import { WorkerEntrypoint } from "cloudflare:workers";

// The Browser Run binding for tests (src/test/wrangler.jsonc binds BROWSER to
// this Worker), so no test runs a browser: a screenshot answers with a small
// JPEG that names the page it was asked for, and the test reads what was
// asked. Tests drive it through the harness (TestServer.browser).

type Shot = { url?: string; viewport?: unknown; waitForSelector?: unknown; screenshotOptions?: unknown };

const shots: Shot[] = [];
// How many of the next screenshots fail, as a page that never gets ready does.
let failing = 0;

export default class BrowserStub extends WorkerEntrypoint {
  // The binding's surface (src/services/preview.service.ts).

  quickAction(action: string, options: Shot) {
    if (action !== "screenshot") throw new Error(`The stub takes screenshots, not ${action}`);
    shots.push(options);
    if (failing > 0) {
      failing--;
      return Response.json({ success: false, errors: [{ code: 422, message: "Waiting for selector failed" }] }, { status: 422 });
    }
    return new Response(`a picture of ${options.url}`, { headers: { "content-type": "image/jpeg" } });
  }

  // For tests.

  /** The screenshots asked for since the last call, oldest first. */
  takeShots() {
    return shots.splice(0);
  }

  /** Makes the next `times` screenshots fail. */
  setFailing(times: number) {
    failing = times;
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}
