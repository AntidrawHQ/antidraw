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

// Whether a certificate error on `url` is one to let through: the same local
// servers, for the connection the check above never saw.
//
// A canvas opens with a burst of connections to its dev server. Chromium
// verifies the certificate once for all of them, and a connection that
// starts as that finishes takes the stored verdict (self-signed: invalid)
// without asking the check above. Every frame loading over it failed with
// ERR_CERT_AUTHORITY_INVALID and stayed empty, in some launches and not others.
// Chromium reports that failure as a certificate error on the frame's
// navigation, which main answers with this (the app's certificate-error).
export const trustsCertificateErrorOn = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && LOCAL_HOSTS.has(hostname);
  } catch {
    return false;
  }
};
