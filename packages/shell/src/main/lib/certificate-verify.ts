import type { Request } from "electron";

// The default session's certificate check: trust any certificate for the
// app's own local servers (workspace dev servers serve self-signed HTTPS on
// localhost), and leave every other host to Chromium's verification.
//
// Electron's callback codes: 0 accepts, -2 rejects, -3 uses Chromium's own
// result. Rejecting (-2) here once failed every HTTPS request the app made to
// any other host, the Antidraw API included.
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const verifyCertificate = (
  request: Pick<Request, "hostname">,
  callback: (verificationResult: number) => void,
) => {
  callback(LOCAL_HOSTS.has(request.hostname) ? 0 : -3);
};
