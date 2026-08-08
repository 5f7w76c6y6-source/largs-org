# The metronome — runbook

A Cloudflare Worker that fires on Cloudflare's cron (`:03` and `:33`,
every hour) and dispatches the `build-and-deploy.yml` workflow via
GitHub's API. It exists because GitHub's own cron honoured roughly one
slot in sixteen over the first four days; Cloudflare's cron actually
fires. The workflow's schedule stays on as a backup — overlaps are
cancelled by the workflow's concurrency group.

## The token (mint once, carefully)

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token.

- **Repository access:** Only select repositories →
  `5f7w76c6y6-source/largs-org`. Nothing else.
- **Permissions → Repository permissions → Actions: Read and write.**
  Every other permission stays "No access". This is the whole surface:
  the token can start this repo's workflows and nothing more.
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

## Verifying it works

Wait for the next `:03` or `:33`, then:

```
gh run list --limit 5
```

A fresh run with EVENT `workflow_dispatch` on the half hour is the
metronome's signature (pushes also say `workflow_dispatch`? No —
pushes say `push`; only the metronome and the Actions tab produce
`workflow_dispatch`). Live logs, if ever needed:
`npx wrangler tail largs-metronome` while a tick fires.

## When it breaks

- No `workflow_dispatch` runs appearing → `npx wrangler tail` over a
  tick. HTTP 401 = token expired or rolled without re-putting; 404 =
  token lacks access to the repo (wrong repository selected, or
  Actions permission missing); 403 with a rate message = something is
  very wrong, read the body.
- Rolled the token on GitHub → `npx wrangler secret put GITHUB_TOKEN`
  with the new one. Nothing else changes.
- Retiring the metronome entirely → `npx wrangler delete` in this
  directory, then delete the token on GitHub.

## Changing the cadence

Edit `crons` in `wrangler.toml`, then `npx wrangler deploy` again.
The Worker only redeploys when you redeploy it — pushing this
directory to GitHub changes nothing on Cloudflare.
