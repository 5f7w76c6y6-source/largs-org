# The metronome — runbook

A Cloudflare Worker that fires on Cloudflare's cron (`:03` and `:33`,
every hour) and dispatches workflows via GitHub's API. It exists
because GitHub's own cron honoured roughly one slot in sixteen over the
first four days, and ran Agenda watch's nightly slot six and a half
hours late on its first night; Cloudflare's half-hourly cron has fired
every time since August.

One trigger, two jobs (since 10 October 2026):

| On every tick | What happens |
|---|---|
| always | dispatch `build-and-deploy.yml` — the half-hourly heartbeat, offset from GitHub's own 2,17,32,47 schedule, whose concurrency group settles any overlap. |
| from `AGENDA_NOT_BEFORE` (05:00 UTC) onward | ask GitHub whether `agenda-watch.yml` has run yet today (UTC); if not, dispatch it first. Normally that is the 05:03 tick: the collection commits in four or five minutes and the 05:33 build publishes — about 06:35 on the page in British Summer Time, 05:35 in winter. |

The check on every later tick is the point: a tick Cloudflare skips
costs thirty minutes, not a day. A manual "Run workflow" earlier in the
same UTC day counts as done, so pressing it at 01:00 means no nightly
that morning. The tick is recognised by the time it was *due*, so a
late delivery cannot move it across the threshold or across midnight.
`agenda-watch.yml` has no GitHub schedule of its own — this is its
only clock.

Why not a daily cron trigger: one was tried (`20 5 * * *`, 9 Oct 2026).
The dashboard showed it registered with a next-run time; Cloudflare did
not invoke it — the Worker's metrics showed 48 invocations that day,
not 49. A job that depends on one tick a day is a job that can be
skipped; this one asks after itself.

## The token (mint once, carefully)

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token.

- **Repository access:** Only select repositories →
  `5f7w76c6y6-source/largs-org`. Nothing else.
- **Permissions → Repository permissions → Actions: Read and write.**
  Every other permission stays "No access". This is the whole surface:
  the token can list and start this repo's workflows (any of them)
  and nothing more.
- **Expiration:** take "No expiration" if offered; otherwise the
  longest available, and calendar the renewal next to the UKHO one.
  An expiring token means the heartbeat silently stops on some future
  anniversary — the mitigation is the narrow scope, not a countdown.
- The token's entire journey: GitHub → clipboard →
  `npx wrangler secret put GITHUB_TOKEN`. Never echoed, never in a
  file, never in this repo. A seen token is a burned token — roll it
  (delete on GitHub, mint again, `secret put` again).

## Bring-up (one time)

```
cd ~/Developer/largs-org/worker
npx wrangler deploy                    # creates the Worker + cron
npx wrangler secret put GITHUB_TOKEN   # paste the token at the hidden prompt
```

Deploy first, then the secret: putting a secret before the Worker
exists makes wrangler invent a draft. The one cron tick that may fire
between the two commands fails harmlessly and shows in the logs.
Secrets survive later redeploys; only the first deploy needs the
`secret put`.

## Verifying it works

Wait for the next `:03` or `:33`, then:

```
gh run list --limit 4 --json createdAt,event,workflowName,conclusion -q '.[] | "\(.createdAt)  \(.event)  \(.workflowName)  \(.conclusion)"'
```

Times print in UTC. A fresh `workflow_dispatch` build on the half hour
is the metronome's signature (pushes say `push`; only the metronome and
the Actions tab produce `workflow_dispatch`). The Actions tab labels a
metronome run "Manually run by" the token's owner, because the API
dispatch is made with that owner's token — an Agenda watch run
"manually run by" you at 05:03 UTC is the nightly working.

Every tick also writes log lines — `tick due …; nightly: …`,
`dispatched …` — to the Worker's **Observability** tab in the dashboard
(Workers & Pages → largs-metronome), kept three days. Live:
`npx wrangler tail largs-metronome` while a tick fires.

**To prove the nightly path today** rather than wait for 05:03, as long
as Agenda watch has not already run today (UTC): deploy once with the
threshold at midnight —

```
npx wrangler deploy --var AGENDA_NOT_BEFORE:00:00
```

— and after the next tick `gh run list` should show an Agenda watch run
and a build, both `workflow_dispatch`. Then `npx wrangler deploy` with
no `--var` restores the value in `wrangler.toml`. The tick after that
finds today's run and leaves it alone.

## When it breaks

- No `workflow_dispatch` runs appearing → the Observability tab, or
  `npx wrangler tail` over a tick. HTTP 401 = token expired or rolled
  without re-putting; 404 = token lacks access to the repo (wrong
  repository selected, or Actions permission missing); 403 with a rate
  message = something is very wrong, read the body. "no job for cron"
  = `wrangler.toml` and `metronome.js` disagree on the cron string.
  "AGENDA_NOT_BEFORE …" = the threshold is malformed; the build still
  runs, the nightly does not, and the error repeats every tick until
  it is fixed.
- Nightly missing but builds fine → read the `nightly:` part of the
  tick's log line. "unknown, not dispatching" means GitHub would not
  answer the run listing and nothing was guessed; the next tick asks
  again. "already ran today" names the run it found.
- Rolled the token on GitHub → `npx wrangler secret put GITHUB_TOKEN`
  with the new one. Nothing else changes.
- Retiring the metronome entirely → `npx wrangler delete` in this
  directory, then delete the token on GitHub — and give
  `agenda-watch.yml` a schedule back, or nothing collects.

## Changing the cadence

Edit `crons` in `wrangler.toml` (and `BUILD_CRON` in `metronome.js` to
match) or `AGENDA_NOT_BEFORE`, then `npx wrangler deploy` again. The
Worker only redeploys when you redeploy it — pushing this directory to
GitHub changes nothing on Cloudflare.
