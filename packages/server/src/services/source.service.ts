import { eq } from "drizzle-orm";
import { err, ok, type Result } from "neverthrow";
import type { Db } from "../db";
import { publish, site } from "../db/schema";
import { isArtifactsError } from "../lib/artifacts";
import { apiError, type ApiError } from "../lib/errors";

// Each site's source lives in its own git repo in Artifacts, named after the
// site's id so a renamed slug never moves it. The app pushes to it with a
// short-lived token for that repo alone, and each publish records the commit
// it was built from, which is what a fork clones (forkAccess), with a token
// that can only read.

export type SourceAccess = { remote: string; token: string; expiresAt: string };

// A push of a large workspace runs for minutes, in several requests that each
// check the token.
const TOKEN_TTL_SECONDS = 60 * 60;

export const repoName = (siteId: string) => `site-${siteId}`;

// A token to push is needed only while a publish pushes. The site's next
// token and the publish that names its commit end the ones before, so one a
// failed publish leaves behind lives until the site's next publish, or its
// hour is up. A publish of the site from elsewhere that's still pushing loses
// its token, and is told to try again. A fork's token only reads, and is left
// to run out: a publish of the site mustn't cut a fork of it short.
const revokeTokens = async (repo: ArtifactsRepo) => {
  const { tokens } = await repo.listTokens();
  await Promise.all(
    tokens
      .filter((token) => token.state === "active" && token.scope === "write")
      .map((token) => repo.revokeToken(token.id)),
  );
};

// A repo made a moment ago can answer CREATE_IN_PROGRESS for a little while.
const ready = async (artifacts: Artifacts, name: string) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await artifacts.get(name);
    } catch (error) {
      if (!isArtifactsError(error, "CREATE_IN_PROGRESS") || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
};

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
    const repo = await ready(artifacts, name);
    await revokeTokens(repo);
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

/**
 * Ends the tokens that pushed the site's source, once a publish has named the
 * commit they pushed. Best effort: they run out within the hour anyway.
 */
export const endSourcePush = async (artifacts: Artifacts, siteId: string) => {
  try {
    await revokeTokens(await artifacts.get(repoName(siteId)));
  } catch (error) {
    console.error("Artifacts:", error);
  }
};

export type ForkAccess = SourceAccess & {
  /** The commit the live version was built from. */
  commit: string;
  /** How many commits down main it is, main's head being 1: what a fetch of main needs as its depth. */
  depth: number;
  title: string;
  version: number;
  /** Where the live version's files are served, canvas.json among them. */
  filesUrl: string;
};

// As far down main as the live version's commit is looked for. It's main's
// head unless publishes after it pushed and never went live.
const LOG_PAGE = 50;
const LOG_PAGES = 20;

// Where on main the commit is, main's head being 1; null when it isn't
// within reach.
const depthOf = async (repo: ArtifactsRepo, commit: string) => {
  for (let page = 0; page < LOG_PAGES; page++) {
    const commits = await repo.log({ ref: "main", limit: LOG_PAGE, offset: page * LOG_PAGE });
    const index = commits.findIndex(({ hash }) => hash === commit);
    if (index !== -1) return page * LOG_PAGE + index + 1;
    if (commits.length < LOG_PAGE) return null;
  }
  return null;
};

const notForkable = (message: string) => err(apiError(409, "NOT_FORKABLE", message));

/**
 * What a fork of the site's live version needs: its commit in the site's
 * repo, and a token to fetch it with, which can't push. Ends no other token,
 * so a publish under way keeps its own.
 */
export const forkAccess = async (
  db: Db,
  artifacts: Artifacts,
  siteId: string,
  filesUrlPattern: string,
): Promise<Result<ForkAccess, ApiError>> => {
  const [row] = await db
    .select({
      title: site.title,
      slug: site.slug,
      version: site.seq,
      repo: site.sourceRepo,
      commit: publish.sourceCommit,
    })
    .from(site)
    .innerJoin(publish, eq(publish.id, site.livePublishId))
    .where(eq(site.id, siteId));
  if (!row) return notForkable("This site has nothing published to fork");
  const { repo: name, commit, slug, ...live } = row;
  // Published by an app from before the source was kept.
  if (!name || !commit) return notForkable("This version's source wasn't kept. Publish the site again, then fork it.");
  try {
    const repo = await artifacts.get(name);
    const depth = await depthOf(repo, commit);
    if (depth === null) return notForkable("Couldn't find this version's source. Publish the site again, then fork it.");
    const [{ remote }, token] = await Promise.all([repo.info(), repo.createToken("read", TOKEN_TTL_SECONDS)]);
    return ok({
      ...live,
      remote,
      token: token.plaintext,
      expiresAt: token.expiresAt,
      commit,
      depth,
      filesUrl: filesUrlPattern.replace("*", slug),
    });
  } catch (error) {
    return unavailable(error);
  }
};
