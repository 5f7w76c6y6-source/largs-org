/* The metronome.
 *
 * GitHub's cron is best-effort and, for this repo, mostly best-ignored:
 * four days of ledger showed roughly one honoured slot in sixteen, and
 * Agenda watch's own nightly schedule ran six and a half hours late on
 * its first night. Cloudflare's cron triggers mostly fire, so this
 * Worker runs on Cloudflare's clock and pokes the repository's
 * workflow_dispatch — making "rebuilt every half hour" a fact rather
 * than an aspiration.
 *
 * ONE TRIGGER, TWO JOBS (10 Oct 2026). Every :03 and :33 dispatches the
 * build. From AGENDA_NOT_BEFORE (wrangler.toml, 05:00 UTC) onward, each
 * tick also asks GitHub whether Agenda watch — the nightly North
 * Ayrshire collection — has run yet today (UTC), and dispatches it if
 * not. So the nightly normally goes at 05:03, commits by about 05:10,
 * and the 05:33 build publishes it (06:35 on the page in British Summer
 * Time, 05:35 in winter); if Cloudflare skips the 05:03 tick, 05:33
 * does it; and a manual "Run workflow" earlier in the day counts as
 * done. A dedicated daily cron trigger ("20 5 * * *", added 9 Oct) was
 * tried first: the dashboard showed it registered with a next-run time,
 * and it did not fire — 48 invocations that day, not 49. Hence a job
 * that rides on the half-hourly trigger and checks its own work.
 *
 * agenda-watch.yml has no GitHub schedule of its own — this is its only
 * clock; "Run workflow" in the Actions tab is the manual one.
 *
 * The GitHub token lives ONLY in the Worker's secret store
 * (`npx wrangler secret put GITHUB_TOKEN`), never in this file, never
 * in the repo. Scope: fine-grained, this repository only, Actions
 * read-and-write, nothing else — which covers listing and dispatching
 * any workflow in the repo. See README.md alongside this file.
 *
 * build-and-deploy.yml keeps its GitHub schedule as a backup; its
 * concurrency group cancels the older of two overlapping builds.
 *
 * Failure is loud, and never silent for the other job: whatever happens
 * to the nightly check or dispatch, the build is still dispatched, then
 * any failure is thrown so it shows in the Worker's error metric. If
 * GitHub cannot be asked whether the nightly ran, nothing is guessed:
 * no dispatch, an error, and the next tick asks again. An unknown cron
 * string throws outright. With [observability] on in wrangler.toml,
 * every tick's log lines are in the dashboard under the Worker's
 * Observability tab for three days.
 */

const OWNER = "5f7w76c6y6-source";
const REPO = "largs-org";

// Must match `crons` in wrangler.toml character for character;
// Cloudflare hands the handler the string that fired.
const BUILD_CRON = "3,33 * * * *";
const BUILD = "build-and-deploy.yml";
const AGENDA = "agenda-watch.yml";

const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows`;

function headers(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "largs-org-metronome"
  };
}

/* AGENDA_NOT_BEFORE is "HH:MM" in UTC from wrangler.toml [vars].
 * Returns minutes past midnight, or throws with the reason. */
function parseNotBefore(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!m) throw new Error(`AGENDA_NOT_BEFORE must be "HH:MM" (UTC), got ${JSON.stringify(value)}`);
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`AGENDA_NOT_BEFORE out of range: ${value}`);
  return hour * 60 + minute;
}

/* The UTC date (YYYY-MM-DD) of the newest Agenda watch run of any kind
 * — scheduled, dispatched or manual, finished or not — or null if there
 * has never been one. Throws unless GitHub answers 200. */
async function latestAgendaRunDate(env) {
  const response = await fetch(`${API}/${AGENDA}/runs?per_page=1`, { headers: headers(env) });
  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`listing ${AGENDA} runs failed: HTTP ${response.status} — ${body}`);
  }
  const data = await response.json();
  const run = (data.workflow_runs || [])[0];
  return run ? String(run.created_at).slice(0, 10) : null;
}

async function dispatch(workflow, env) {
  const response = await fetch(`${API}/${workflow}/dispatches`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ ref: "main" })
  });
  // 204 No Content is GitHub's "dispatched". Anything else is worth
  // surfacing — the thrown error shows up in the Worker's metrics and
  // logs instead of failing silently forever.
  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(`dispatch of ${workflow} failed: HTTP ${response.status} — ${body}`);
  }
  console.log(`dispatched ${workflow}`);
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron !== BUILD_CRON) {
      throw new Error(`no job for cron "${event.cron}" — wrangler.toml and metronome.js disagree`);
    }

    // The time the tick was DUE, not the time it was delivered, so a
    // few minutes of delay cannot move a tick across the threshold or
    // across midnight.
    const due = new Date(event.scheduledTime);
    const today = due.toISOString().slice(0, 10);
    const failures = [];

    let nightly = "not due yet";
    try {
      const minutes = due.getUTCHours() * 60 + due.getUTCMinutes();
      if (minutes >= parseNotBefore(env.AGENDA_NOT_BEFORE)) {
        const last = await latestAgendaRunDate(env);
        nightly = last === today ? `already ran today (${last})` : `dispatching (last run ${last || "never"})`;
      }
    } catch (err) {
      nightly = `unknown, not dispatching — ${err.message}`;
      failures.push(err.message);
    }
    console.log(`tick due ${due.toISOString()}; nightly: ${nightly}`);

    // Nightly first, so the build is never what delays it; the build is
    // attempted whatever happened to the nightly.
    const jobs = nightly.startsWith("dispatching") ? [AGENDA, BUILD] : [BUILD];
    for (const workflow of jobs) {
      try {
        await dispatch(workflow, env);
      } catch (err) {
        console.error(err.message);
        failures.push(err.message);
      }
    }
    if (failures.length) throw new Error(failures.join("; "));
  }
};
