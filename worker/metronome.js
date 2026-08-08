/* The metronome.
 *
 * GitHub's cron is best-effort and, for this repo, mostly best-ignored:
 * four days of ledger showed roughly one honoured slot in sixteen.
 * Cloudflare's cron triggers actually fire, so this Worker runs on
 * Cloudflare's clock and pokes the repository's workflow_dispatch —
 * making "rebuilt every half hour" a fact rather than an aspiration.
 *
 * The GitHub token lives ONLY in the Worker's secret store
 * (`npx wrangler secret put GITHUB_TOKEN`), never in this file, never
 * in the repo. Scope: fine-grained, this repository only, Actions
 * read-and-write, nothing else. See README.md alongside this file.
 *
 * The workflow's own schedule stays on as a backup; the concurrency
 * group in build-and-deploy.yml cancels any overlap, so a doubly
 * triggered half hour resolves itself.
 */

const OWNER = "5f7w76c6y6-source";
const REPO = "largs-org";
const WORKFLOW = "build-and-deploy.yml";

export default {
  async scheduled(event, env, ctx) {
    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "largs-org-metronome"
        },
        body: JSON.stringify({ ref: "main" })
      }
    );

    // 204 No Content is GitHub's "dispatched". Anything else is worth
    // surfacing — a thrown error shows up in the Worker's metrics and
    // `npx wrangler tail`, instead of failing silently forever.
    if (response.status !== 204) {
      const body = await response.text();
      throw new Error(`dispatch failed: HTTP ${response.status} — ${body}`);
    }
  }
};
