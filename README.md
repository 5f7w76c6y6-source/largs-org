# largs.org

Community reference site for Largs, North Ayrshire. Static-first, zero
running cost: a scheduled job fetches live data, Eleventy bakes it into
plain HTML, Cloudflare serves it. **The deployed pages contain no
JavaScript at all** — everything, including the "Largs today" board, is
rendered at build time.

## How the pieces fit

```
scripts/fetch-data.mjs   →  writes src/_data/today.json
src/_data/*.json         →  every file here is a global in the templates
                            (Eleventy calls this the data cascade)
src/index.njk            →  the homepage, reads today / events / council
src/_includes/layouts/   →  base.njk: masthead, horizon strip, footer
src/assets/css/site.css  →  the design system from the mock-up
eleventy.config.js       →  directories + date filters (Europe/London)
.github/workflows/       →  fetch → build → deploy, every half hour
```

Templates are Nunjucks (`.njk`): HTML with `{{ variable }}`
interpolation and `{% for %}` / `{% if %}` logic, evaluated once at
build time — think Swift string interpolation writ large, run by the
build rather than the device. Rough Rosetta stone for the tooling:
`package.json` ≈ `Package.swift`, `package-lock.json` ≈
`Package.resolved`, `npm ci` ≈ a clean resolve from the lockfile.

## Run it locally

Prerequisite: Node 22 or newer (`brew install node`, or the installer
from nodejs.org).

1. `npm install` — installs Eleventy into `node_modules/` and writes
   `package-lock.json`. **Commit the lockfile.** The CI build uses
   `npm ci`, which refuses to run without it.
2. `npm run fetch` — pulls live weather and tides from Open-Meteo and
   writes `src/_data/today.json`. Skip it and the site still builds,
   with the tiles honestly badged "sample".
3. `npm run serve` — builds and serves at `http://localhost:8080`,
   rebuilding as you edit. (`npm run build` writes `_site/` and stops.)

## Deploy

One-time setup, roughly ten minutes:

1. **GitHub.** Create a **public** repository and push this folder.
   Public matters: GitHub Actions minutes are unlimited and free for
   public repos, and this schedule uses ~1,450 build-minutes a month.
2. **Cloudflare Pages project.** In the Cloudflare dashboard: Workers
   & Pages → Create → Pages → *Upload assets* (direct upload, **not**
   "Connect to Git"). Name the project `largs-org` — the workflow
   deploys by that name. You can upload your local `_site/` folder
   once to initialise it. (CLI alternative: `npx wrangler login` then
   `npx wrangler pages project create largs-org`.)
3. **API token.** Cloudflare dashboard → My Profile → API Tokens →
   Create Token → Custom token, with the single permission
   *Cloudflare Pages: Edit*. Copy the token. Your **Account ID** is in
   the dashboard's right-hand sidebar.
4. **Secrets.** In the GitHub repo: Settings → Secrets and variables →
   Actions → New repository secret. Add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
5. Push to `main`, or run the workflow by hand (Actions tab → *Build
   and deploy* → Run workflow). The site appears at
   `https://largs-org.pages.dev` — which doubles as the staging domain
   until largs.org itself is in hand.

### Why deploy this way round

Cloudflare's own git-connected build system caps at 500 builds per
month on the free plan; a half-hourly schedule is ~1,450. Direct
uploads via `wrangler pages deploy` don't count against that quota, so
GitHub Actions does the building (free on a public repo) and Cloudflare
just hosts. One pipeline, one set of logs, secrets in one place.

## Gotchas

- **Scheduled workflows pause after 60 days without repo activity**
  (a GitHub anti-abandonment measure). If the Today board goes stale,
  open the Actions tab — one click re-enables the schedule, and any
  small commit resets the clock.
- **Cron is best-effort.** The workflow runs at :17 and :47 because
  jobs scheduled on the hour queue behind everyone else's. Expect a few
  minutes of jitter.
- **Timezones.** Build machines run UTC. All date formatting goes
  through the filters in `eleventy.config.js`, which pin
  Europe/London; the fetch script requests epoch timestamps from the
  marine API for the same reason. Follow suit in anything new.

## Data honesty

The tide times come from Open-Meteo's ocean model — good for a glance
at the prom, not chart-grade. The seams for the real upgrades are
marked `TODO` at the top of `scripts/fetch-data.mjs`: UKHO Admiralty
tidal predictions (free key, stored as an Actions secret), CalMac
service status, and the roadworks feed. The badges on the Today board
(`live` / `timetable` / `sample`) exist so the page never pretends.

## Not in this skeleton yet

Events submission → moderation queue, the Council corner minutes-digest
workflow (Claude API draft → human approval), the directory pages, the
newsletter provider, and the archive crawl of the original site. Each
lands as its own small working piece.
