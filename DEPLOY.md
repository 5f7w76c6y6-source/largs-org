# DEPLOY.md — how largs.org ships

The operational runbook: how a change gets from this folder to the live
site, how the automation is wired, and how to set up a fresh machine or
recover this one. README.md covers what the site *is* and how to run it
locally; this file covers everything with a credential in it. Written
after the first deployment on 3 August 2026 — every gotcha below was
hit for real that evening.

## The shape of it

Three layers, each proven before the next was stacked on it:

1. **Laptop build** — `npm run fetch && npm run build` produces `_site/`.
2. **Manual deploy** — `npx wrangler pages deploy _site
   --project-name=largs-org` puts `_site/` on Cloudflare's edge.
3. **Automation** — `.github/workflows/build-and-deploy.yml` does both
   of the above on GitHub's machines: on every push to `main`, on a
   half-hourly schedule (`:17` and `:47`), and on demand.

The live site is **https://largs-org.pages.dev** — that address always
points at the newest production deployment. Every individual deployment
also gets a permanent snapshot URL (`https://<hash>.largs-org.pages.dev`,
printed by wrangler and listed in the Cloudflare dashboard). Snapshots
never change, which makes rollback simple: find the last good one,
confirm it looks right, and redeploy that commit.

## Day to day: shipping a change

```
cd ~/Developer/largs-org
# ...edit...
npm run serve          # check at http://localhost:8080, Ctrl+C to stop
git add <the files>
git commit -m "what changed and why"
git push
```

The push triggers a build; about thirty seconds later the change is
live. `gh run list` shows recent runs, `gh run watch` follows one in
progress. Note that *any* push rebuilds the whole site, including a
fresh data fetch — so the "Updated" stamp on the Today board moves even
when the change was only to a file like this one.

## The machinery

**Triggers.** Push to `main`; cron at `:17` and `:47` (odd minutes on
purpose — jobs scheduled on the hour queue behind everyone else's); and
manual, either from the Actions tab (*Build and deploy → Run workflow*)
or `gh workflow run build-and-deploy.yml`.

**Cron is best-effort.** A few minutes of jitter is normal, more at
busy times, and GitHub occasionally skips a slot entirely — the first
night it honoured one slot in twenty, then perked up by morning. One
missed half-hour does not matter for tide times.

**Overlaps cancel.** The workflow declares a concurrency group with
`cancel-in-progress: true`: if a new run starts while an older one is
mid-flight, the older one is cancelled and the newer wins. A run marked
"cancelled" next to a green one is the system working, not failing.

**Schedules pause after 60 days of repo inactivity.** GitHub's
anti-abandonment measure. Symptom: the site's Updated stamp goes stale
and `gh run list` shows nothing recent. Fix: Actions tab → re-enable
the workflow (one click), or make any small commit.

**Secrets.** Held on the repo (Settings → Secrets and variables →
Actions): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are
required; `ADMIRALTY_KEY` is optional — absent, the tide tile uses the
Open-Meteo ocean model; present, it uses UKHO Admiralty predictions.
Setting it is the UKHO go-live switch and waits for their written OK.
`gh secret list` shows names and dates only — safe to share anywhere.
Re-running `gh secret set NAME` overwrites cleanly.

**The UKHO subscription lasts one year.** When it lapses, nothing
breaks loudly: the fetch quietly falls back to the ocean model and the
colophon credit switches back to Open-Meteo. Calendar the renewal, and
treat "colophon says Open-Meteo again" as the symptom.

## Fresh machine setup

1. **Node** — installer from nodejs.org, v20 or newer (v22 matches CI).
   Check with `node --version`.
2. **GitHub CLI** — https://github.com/cli/cli/releases/latest. The
   asset labels hide file extensions: the row to take is **macOS
   universal** (~27 MB) — that is the `.pkg` installer. The "macOS
   arm64"/"amd64" rows are bare-binary zips that need PATH surgery.
   The pkg is *not notarised*, so Gatekeeper blocks it: verify the
   download first (`shasum -a 256 ~/Downloads/gh_*.pkg` must match the
   sha256 shown on the release page), then System Settings → Privacy &
   Security → **Open Anyway**.
3. **Sign in** — `gh auth login`: GitHub.com → HTTPS → **Yes** to
   authenticating Git → login with a web browser. The one-time code
   expires in minutes; click through promptly.
4. **Git identity** — commits must never carry a machine-generated
   address like `@M2-MBA.local`. Use the noreply address from GitHub →
   Settings → Emails (keep "Keep my email addresses private" **on**,
   and tick "Block command line pushes that expose my email"):

   ```
   git config --global user.name  "Ian McColm"
   git config --global user.email "307743378+5f7w76c6y6-source@users.noreply.github.com"
   ```

   `git commit --amend --reset-author --no-edit` re-stamps the latest
   commit — safe **only** before it has been pushed.
5. **Clone and install** —
   `gh repo clone 5f7w76c6y6-source/largs-org ~/Developer/largs-org`,
   then `npm install` inside it.
6. **wrangler** — `npx wrangler login`. The consent screen lists ~28
   permissions; that is the CLI's whole surface, not this project's.
   The grant lives on the laptop and is revocable (Cloudflare → My
   Profile → Access Management → Connected Applications, or
   `npx wrangler logout`). Complete the browser step promptly — the
   login times out. `npx wrangler whoami` prints the account ID.

## The Cloudflare token rules

The deploy token is minted at dash.cloudflare.com → My Profile → API
Tokens → Create Token → **Custom token**:

- **Exactly one permission: Account · Cloudflare Pages · Edit.** The
  summary page must literally read `Cloudflare Pages:Edit`. A Read
  token passes every step of the pipeline and fails only at the final
  deploy — miserable to debug — so check the summary, not the form.
- **No client IP filter.** The token's user is GitHub's build machines,
  a different address every run. "Use my IP" breaks every deploy.
- **No expiry.** An expiring token means the site silently stops
  updating on some future anniversary. The leak mitigation is the
  narrow scope, not a countdown.
- **A seen token is a burned token.** Screenshot, chat message, note —
  if the secret has existed anywhere outside its vault and the
  clipboard, Roll it (⋯ menu next to the token: same name and
  permissions, new secret) and re-run
  `gh secret set CLOUDFLARE_API_TOKEN`.
- **Never run the "Test this token" curl** offered on the reveal page —
  it embeds the secret in plain text in shell history. The pipeline is
  the test.
- Every secret's entire journey: vault → clipboard → `gh secret set`
  (or `read -s` + `export` for a session-only local test). Nowhere
  else, ever. The same rules cover the UKHO key.

## Renames and the long game

Renaming the GitHub account is not free: repository URLs redirect, but
`*.github.io` Pages URLs (works-chart) simply break, and the old
username becomes claimable by anyone. The better long-term move is a
community GitHub **organisation** for the town's code — transferring a
repository into an organisation preserves redirects. After any
transfer, re-enter the secrets on the repository's new home.

## When it breaks

- `gh run list` shows ✗ → `gh run view --log-failed`; the last twenty
  lines almost always say plainly what happened.
- `npm ci` fails in CI → `package-lock.json` missing from the repo.
- Deploy step fails with an authentication error → token permission
  (Read instead of Edit?) or a rolled token whose new secret was never
  re-set.
- Tides unexpectedly credited to Open-Meteo in the colophon → the UKHO
  key has lapsed or their API is down; the fetch logs say which.
- Site stale and no recent runs → schedule auto-disabled at the 60-day
  mark; Actions tab, one click.
- Locally, "could not read package.json" → wrong directory; `pwd`.

## Safe self-checks

None of these can output a secret:

```
git log -1 --format='%an <%ae>'   # who commits are stamped as
gh secret list                    # secret names and dates only
gh run list                       # recent builds and their triggers
npx wrangler whoami               # account and (non-secret) account ID
```
