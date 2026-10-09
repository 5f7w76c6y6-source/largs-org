/* The metronome.
 *
 * GitHub's cron is best-effort and, for this repo, mostly best-ignored:
 * four days of ledger showed roughly one honoured slot in sixteen.
 * Cloudflare's cron triggers actually fire, so this Worker runs on
 * Cloudflare's clock and pokes the repository's workflow_dispatch —
 * making "rebuilt every half hour" a fact rather than an aspiration.
 *
 * TWO CLOCKS SINCE 9 OCT 2026. The half-hourly one dispatches the
 * build, as before. The once-a-day one, 05:20 UTC, dispatches Agenda
 * watch (agenda-watch.yml), whose own GitHub schedule for that minute
 * was simply not run on its first night — the one-in-sixteen rule
 * again. Cloudflare passes the handler the cron string that fired,
 * verbatim from wrangler.toml, and the table below maps each string to
 * a workflow. A string that is not in the table throws: a cron added to
 * wrangler.toml without a row here fails loudly in the Worker's metrics
 * and `npx wrangler tail`, rather than quietly dispatching the wrong
 * workflow.
 *
 * The GitHub token lives ONLY in the Worker's secret store
 * (`npx wrangler secret put GITHUB_TOKEN`), never in this file, never
 * in the repo. Scope: fine-grained, this repository only, Actions
 * read-and-write, nothing else — which covers dispatching any workflow
 * in the repo, so the second clock needed no new token. See README.md
 * alongside this file.
 *
 * The workflows' own GitHub schedules stay on as a backup. Overlaps are
 * settled by each workflow's concurrency group: build-and-deploy.yml
 * cancels the older of two builds; agenda-watch.yml queues the second
 * run behind the first (it recollects and commits fresh stamps, which
 * is harmless, and happens only on the rare night GitHub honours its
 * own slot).
 */

const OWNER = "5f7w76c6y6-source";
const REPO = "largs-org";

// Keys must match the `crons` entries in wrangler.toml character for
// character; that file is the only place the strings come from.
const WORKFLOWS = {
  "3,33 * * * *": "build-and-deploy.yml",
  "20 5 * * *": "agenda-watch.yml",
};

export default {
  async scheduled(event, env, ctx) {
    // `event.cron` is the trigger that fired, as written in wrangler.toml.
    const workflow = WORKFLOWS[event.cron];
    if (!workflow) {
      throw new Error(
        `no workflow for cron "${event.cron}" — wrangler.toml and the WORKFLOWS table disagree`
      );
    }

    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`,
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
      throw new Error(`dispatch of ${workflow} failed: HTTP ${response.status} — ${body}`);
    }
  }
};
