import { eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Db } from "../db";
import { site } from "../db/schema";
import { isArtifactsError, type Artifacts } from "../lib/artifacts";
import { apiError, type ApiError } from "../lib/errors";

// Each site's source lives in its own git repo in Artifacts, named after the
// site's id so a renamed slug never moves it. The app pushes to it with a
// short-lived token for that repo alone, and each publish records the commit
// it was built from, which is what a remix clones.

export type SourceAccess = { remote: string; token: string; expiresAt: string };

// A push of a large workspace runs for minutes, in several requests that each
// check the token.
const TOKEN_TTL_SECONDS = 60 * 60;

export const repoName = (siteId: string) => `site-${siteId}`;

const unavailable = (error: unknown) => {
  console.error("Artifacts:", error);
  return err(apiError(502, "SOURCE_UNAVAILABLE", "Couldn't reach the source storage; try again"));
};

/** The site's repo, made on first use, and a token to push to it. */
export const sourceAccess = async (
  db: Db,
  artifacts: Artifacts,
  siteId: string,
): Promise<Result<SourceAccess, ApiError>> => {
  const name = repoName(siteId);
  try {
    const [row] = await db.select({ repo: site.sourceRepo }).from(site).where(eq(site.id, siteId));
    if (!row?.repo) {
      try {
        await artifacts.create(name, { setDefaultBranch: "main" });
      } catch (error) {
        // Another first publish of the site made it.
        if (!isArtifactsError(error, "ALREADY_EXISTS")) throw error;
      }
      await db.update(site).set({ sourceRepo: name }).where(eq(site.id, siteId));
    }
    const repo = await artifacts.get(name);
    const [{ remote }, token] = await Promise.all([repo.info(), repo.createToken("write", TOKEN_TTL_SECONDS)]);
    return ok({ remote, token: token.plaintext, expiresAt: token.expiresAt });
  } catch (error) {
    return unavailable(error);
  }
};

/** Whether the site's repo has the commit, so a publish can say it was built from it. */
export const hasSourceCommit = async (
  db: Db,
  artifacts: Artifacts,
  siteId: string,
  commit: string,
): Promise<Result<boolean, ApiError>> => {
  try {
    const [row] = await db.select({ repo: site.sourceRepo }).from(site).where(eq(site.id, siteId));
    if (!row?.repo) return ok(false);
    const repo = await artifacts.get(row.repo);
    return ok((await repo.readCommit(commit)) !== null);
  } catch (error) {
    return unavailable(error);
  }
};
