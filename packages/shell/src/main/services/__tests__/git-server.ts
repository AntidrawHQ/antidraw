import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * git's own http-backend for the bare repos in root, asking for this
 * Authorization header: a site's repo as Artifacts serves it. Answers its
 * address, and the server to close.
 */
export const startGitServer = async (root: string, authorization: string) => {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== authorization) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="git"' }).end();
      return;
    }
    const url = new URL(req.url!, "http://localhost");
    const backend = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        REMOTE_USER: "x",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers["content-type"] ?? "",
        GIT_PROTOCOL: String(req.headers["git-protocol"] ?? ""),
      },
    });
    backend.stdin.on("error", () => {});
    req.pipe(backend.stdin);
    // A CGI's answer: headers, Status among them, then a blank line.
    let head: Buffer | null = Buffer.alloc(0);
    backend.stdout.on("data", (data: Buffer) => {
      if (!head) return void res.write(data);
      head = Buffer.concat([head, data]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      for (const line of head.subarray(0, end).toString().split("\r\n")) {
        const [name = "", value = ""] = line.split(/:\s*/, 2);
        if (name.toLowerCase() === "status") res.statusCode = parseInt(value);
        else res.setHeader(name, value);
      }
      res.write(head.subarray(end + 4));
      head = null;
    });
    backend.on("close", () => res.end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
};
