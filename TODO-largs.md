# largs.org — open threads

Written 12 August 2026, updated 14 August. Keep this in the repo root so it is
impossible to lose. Delete a line when it is genuinely done, not when it is
planned.

## Must do before sharing the link with anyone

Nothing outstanding. The referee pass is complete — 80 entries, 239 citations,
all sixteen meetings read in full against every entry citing them, 13 August.
See `referee-audit-record.md`. The elections entry was corrected in that pass.

The preview link has been sent to Linda Smith and opened, so this section is now
historical: anything added below is a correction to something already visible.

## Corrections and promises to keep

- [ ] **Publish a way to report a mistake.** The how-this-works page promises
      that errors will be checked against source and corrected, but gives no
      address to report one to. That promise is the main practical protection
      against a complaint escalating, and it is currently unreachable.
      Use `largsevents@gmail.com` for now, labelled clearly as the route for
      corrections as well as events, and move it to an address on the domain
      at launch — Cloudflare Email Routing is free and needs no mailbox.
- [ ] **"Within a fortnight of 13 Aug"** on the Starting soon roadworks page.
      The filter now has a floor as well as a ceiling, so it means the fortnight
      *after* the register's data date. Reword to say so.
- [ ] **Web Analytics is a documented exception, not yet documented.** Enabled
      on `largs-preview` on 14 August; it injects a script on every page, which
      is the site's third JavaScript exception after maps and lightbox — and the
      first that serves the site's owner rather than the reader.
      - Add a footer line at launch: visitor numbers counted, no cookies, no
        personal data.
      - Add a comment near the "no JavaScript on the front page, by design"
        note in `index.njk`, which a reader will otherwise find contradicted.
      - If `largs-preview` is deleted as planned, the analytics go with it and
        the live site needs its own switch.

## Structural, before July's minutes go in

- [ ] **Derive "no recent update" from the dates.** The status is hand-set and
      drifted on 14 August — `pavement-parking` showed "no recent update" while
      citing the most recent meeting in the file. The staleness line already
      computes the same thing from `lastRecorded`, so the stored status is
      saying twice what the build can say once.
      This is not only a template change: the twelve entries currently marked
      `no-update` each need a real base status assigned — `raised`, `progress`
      or `completed` — which is editorial work against the minutes. Best done
      while digesting July's minutes after the 20th, since statuses get
      revisited then anyway.
      Note the definition lives in **three places**: `council.json`'s
      `statuses` blurb, its `_comment`, and `register.njk`'s status key.

## Newsletter

- [ ] **Wire the Largs Letter signup to a real provider.** The mailto is honest
      and working, but manual. Buttondown's free tier gives a form endpoint, an
      archive and clean export; Mailchimp is the alternative. Not finished until
      an address entered on the site lands somewhere by itself.
- [ ] First issue: no date committed. Content is not the constraint — audience
      is. Write it when there is someone to send it to.

## Council corner

- [ ] Replace the placeholder yoga entry in `events.json` with the real venue,
      time and contact.
- [ ] **Football Memories at the Cameron Centre** belongs in `events.regulars`
      on What's On, not the register. From the February 2026 minutes.
- [ ] Three sets of 2025 minutes still missing: **March, October, December**.
      Both October and December are recorded as having taken place. Supporting
      fact for the nudge: the November 2025 minutes record NAC saying they had
      "now updated all LCC minutes" on their website, and those three still are
      not there — which corroborates Linda's account that the gap is theirs.
- [ ] Tell Linda the **May Street steps appear to be built** — ask whether it
      was ever minuted. The register cannot close it on an observation, but the
      Community Council can close it in their own record. Better asked in
      person than by email.
- [ ] **The amendment rule.** July 2025 item 6 amends the June minutes to read
      "play area at Linn Avenue" where the published June document says
      Alexander Avenue. A reader checking our entry against NAC's copy would
      find a discrepancy that is ours to explain. Worth a line in `_rules` and
      on the policy page: where a later meeting amends a minute, the amended
      version governs.
- [ ] **The "nothing here is paid for" paragraph**, drafted 14 August but not
      placed. States that Council corner carries no advertising or sponsorship
      and that nobody can pay to appear, to be described differently, or to
      have an entry removed. Becomes more useful, not less, if the rest of the
      site ever earns anything.
- [ ] **`rose-garden` against the routine-business test.** A quotation for
      chippings and a weed barrier sits close to "routine internal business
      stays out". Predates the referee pass. Worth a look when all 80 entries
      can be seen against that test at once.
      **Safety note:** April 2026's *memorial* rose garden is a different thing
      entirely and must never be added to that entry. Rule 12 bars anything
      about a death, a fatal accident enquiry, or a memorial arising from one.

## Parked, waiting on someone else

- [ ] **Planning applications page — parked pending permission, not
      abandoned.** Fully specified on 15 August: ArcGIS REST at
      `Planning_Information/MapServer/0`, fetch by date and filter to KA30 in
      our own code (the service 502s on address filtering — `ADDRESS` is on a
      joined table). No consultation-expiry field exists anywhere in the
      service's 24 layers, so a comment window would have to be estimated from
      `DATEAPVAL` and labelled as approximate.
      **Blocked because the service carries no licence statement.**
      `Open_Data_Portal` states OGL v3; `Planning_Information` states nothing
      and calls itself "LVIntranet Service for use in LocalView Intranet".
      An email to `opendata@north-ayrshire.gov.uk` is drafted and unsent —
      decide by Monday whether to send it. It also asks whether the weekly
      list of validated applications is available in re-usable form, which
      would supply the missing comment deadline.
      **Same finding applies to the works-chart project**, more strongly:
      commercial re-use is exactly what NAC's guidance walls off.
- [ ] **`report-it.njk` — built, builds, deliberately not in the nav.** Roads
      and street lights verified live, with the A78 trunk-road carve-out
      (Amey for Transport Scotland) and the 01294 310000 emergency number.
      CSS is already appended to `site.css`. The `base.njk` nav and footer
      patch is **written but unrun**.
      Held because the "When to bring it to the Community Council" section
      describes LCC's role in public — signposting the council's own forms
      needs nobody's permission, but characterising what a body does is
      speaking for it. Show Linda the direct URL first; it becomes an offer
      rather than a fact.
      Partly discharges the corrections-route promise above, but only once it
      is reachable.

## The council-papers watcher

Built 16 August. The page exists at `/on-the-agenda/`, with the calendar at
`/on-the-agenda/scheduled/`. Both are committed and **not in the nav**.
Collection tools live in a separate project, `~/Developer/agenda-watch`:
`collect.py` (search), `calendar.py` (committee pages), `snippets.py`
(reads packs, a private reading tool), `reconcile.py`, `terms.py`, `counts.py`.

- [x] ~~Make the CMIS search scriptable.~~ Done — an ASP.NET postback with
      `Simple`, lowercase `documents`, multipart, pager `grdDocuments` /
      `Page$N`. **But the search is not the collection mechanism**: it caps
      or relevance-cuts at about 500, so "North Coast" reports 519 and plain
      "North" only 424. Meeting dates now come from the committee pages
      instead, which need no form at all.
- [ ] **Add the locality terms.** "North Coast" appears on 109 pages where
      "Largs" does not, across 11 of 21 packs — the largest single gap, and
      invisible to the town-name search. Needs local grepping, since
      searching it at CMIS returns the whole authority. Until it is in, the
      page's claim stays "mentions Largs" and must not become "concerns
      Largs".
- [ ] **Noise filtering before the wording changes.** Common Good tables and
      settlement lists mean a mention is often furniture. "Concerns" is a
      false claim on those rows until they are demoted.
- [ ] **How the search was made scriptable, kept for the record:** Establish whether
      `north-ayrshire.cmis.uk.com/north-ayrshire/Search.aspx` is a GET with
      query parameters or a form post, and whether results can be filtered by
      date. Searching "largs" returns **469 documents**, newest first, with
      per-document hit counts — the council has already built the detection
      layer, so nothing needs crawling.
- [ ] **Detection is a string match, never a model.** The model's only job is
      materiality judgement on a passage that provably contains the word, and
      a human gates everything before publishing. It locates and links; it
      never characterises. Every published item carries document, item and
      link so the claim is checkable in one click.
- [ ] **Must run daily.** Agendas publish at least three days before a
      meeting; that notice period is the entire value. A monthly run reads
      papers after the decision.
- [ ] **First live test: Cabinet, 1 September 2026.** Papers publish around
      27 August.

Structure notes: meeting pages are
`.../ViewMeetingPublic/mid/397/Meeting/{id}/Committee/{id}/` with sequential
integer IDs; **agenda item titles and summaries are in the meeting page HTML**,
so a cheap first pass never opens a PDF; **every agenda item has its own
permalink** under `.../ViewCMIS_DecisionDetails/.../Id/{guid}/`, which is the
right link target. `Document.ashx` URLs are ~700 characters with encrypted
tokens, cannot be constructed, and must be harvested — but appear durable
(search engines have indexed them). The search results' magnifier icon is
**broken**, throwing an ASP.NET exception, so the in-context snippet view
cannot be relied on. CMIS meeting pages carry `noindex,nofollow`.

Committees that matter: North Ayrshire Council, Cabinet, Audit and Scrutiny,
Licensing Committee, Licensing Board, Local Development Plan, the three
Planning variants, Integration Joint Board. There is no North Coast Locality
Partnership.

**The proof:** the 12 August Licensing Board pack carries the Paddle Steamer,
1 The Promenade — a Wetherspoon variation LCC objected to, continued to
**7 September 2026**. The register already has it (`IN PROGRESS`, last
recorded 18 June), so the two sources agree. But the Board sat on 8 June and
the register records it on the 18th, and the hearing falls between LCC's
August and September meetings. **The claim is timing, not discovery.**

- [ ] **A second source for the register.** A watcher could tell Council corner
      when the outside world moves an item on — a hearing happens, a decision
      lands — so entries stop being frozen at the last date LCC mentioned them.

## Ask Committee Services

- [ ] **`committeeservices@north-ayrshire.gov.uk` handles committees, community
      councils and outside bodies** — very likely the team that receives LCC's
      minutes under the Scheme's three-week rule, and therefore able to answer
      the missing March, October and December 2025 question independently of
      Linda.
      Supporting fact from the Community Council Scheme: the community council
      must supply one copy of the minutes to the Council **within three weeks**
      of each meeting. So if Linda has been sending them, NAC has them.

## Commercial questions, undecided

- [ ] **Reconcile the domain pitch pack with actual intentions.** It commits in
      writing to "profits directed to local community groups". If the plan is
      personal income, that wording must change *before* the largs.org
      conversation, not after. Settled so far: the public will never be charged,
      and Council corner is an island — no advertising or sponsorship, ever.
- [ ] **"Free to list" is unresolved.** Removed from the footer on 14 August so
      it no longer promises anything, but the question stands: would a business
      ever pay to appear on What's On?
- [ ] **Ask a Scottish solicitor about the vehicle**, alongside the revenue
      question. If the site becomes a company or CIC, liability sits differently
      than it does with an individual. Relevant to the defamation exposure on
      entries that name people in connection with something unflattering — all
      accurately minuted and attributed, but they are the sentences that would
      ever be argued about.

## At launch (largs.org handover)

- [ ] Delete `src/_headers` **and** its `addPassthroughCopy` line in
      `eleventy.config.js` to go indexable. Full steps in DEPLOY.md.
      **Pair the deletion with a curl confirming the header is gone** — on
      13 August the rule was correct in the repo and absent from every deployed
      page for two days, because nothing checked it.
- [ ] **Delete the `largs-preview` Cloudflare project** and remove the mirror
      block from `.github/workflows/build-and-deploy.yml`. It retires itself on
      30 September 2026 (`PREVIEW_UNTIL`) and says so in the Actions log, but
      the project still wants deleting.

## Hardware projects, for when back north

Two ideas from 16 August, both real, both waiting on being in Largs. The
reasoning is recorded so it does not have to be rediscovered.

- [ ] **Who's out on the water — an AIS receiver.** Every commercial vessel
      and most yachts broadcast name, position, course and speed on marine
      VHF (162 MHz) as a public safety system: the ferries, the Waverley,
      Hunterston traffic, a good share of the Yacht Haven's berth-holders.
      **Broadcast into the air, deliberately, for anyone to receive** — no
      gatekeeper, unlike the buses, where the data sits inside operators
      until law extracts it. Commercial aggregators (MarineTraffic etc.)
      are paid or embed-only with third-party scripts: out under the
      site's rules. Data received off the air yourself is yours.
      **The build:** RTL-SDR dongle (~£30) + AIS-catcher (the standard
      open-source decoder) on a Raspberry Pi, pushing a small JSON of
      currently-heard vessels to Cloudflare; a map page in the JavaScript
      family (with Leaflet, where exceptions already live) fetching it
      client-side. Honestly LIVE, per-vessel "last heard N min ago",
      fail-safe wording when the receiver is down.
      **First step, £30, no roof work:** dongle + whip aerial at an
      upstairs window facing the gaps to the water, AIS-catcher for an
      evening. If the window hears the ferry, the roof hears the firth.
      VHF is line-of-sight-plus: gaps between houses act as apertures,
      Class A transmitters (ferries, tankers) are 12.5 W and forgiving,
      Class B yachts are 2 W and the first lost to a poor view. Height
      beats gaps.
      **AISHub** is the endgame: a data-sharing cooperative — feed your
      receiver in, get free API access to everyone's, including existing
      Clyde coverage for the arcs the aerial cannot see. Contribution is
      the currency; no receiver, no membership, which is why this waits.
      **The page claims "vessels heard", never "who's out"** — dinghies
      and many day boats carry no AIS. First running hardware the site
      would have: a Pi, always on.

- [ ] **A real sea-temperature sensor.** The tile currently shows
      Open-Meteo's marine model, badged MODEL, honestly. A thermometer in
      the actual water would earn MEASURED and genuinely differ — shallow
      coastal water runs warmer than the model's grid cell in summer,
      which is the number the swimmers and dookers want.
      **Do not moor anything in open water.** Seabed and foreshore are
      Crown Estate Scotland's; a moored device needs their consent and
      potentially a marine licence, must not hazard the ferry or the
      marina, and becomes a liability the day it breaks loose. The
      planning-licence lesson in physical form: the gate is permission,
      not technology.
      **The route: attach to something that already legally exists** —
      the Yacht Haven's pontoons, the pier, or the sailing club slipway,
      with the owner's blessing. No seabed consent, serviced from a
      walkway, solar-topped, possibly on the marina's Wi-Fi rather than
      cellular. Turns the Yacht Haven ask from "may we show your wind
      data" into "may we clamp a small sensor to your pontoon" — and
      gives them a live sea temperature too.
      Off-the-shelf telemetry buoys are £2,000–5,000: fails zero-cost
      twice over. A DIY probe + microcontroller + LTE-M build is
      £150–300 and a fine project, but only on someone's structure.
      **First step is the pontoon conversation, not the soldering.**

## Considered and binned

- **Food hygiene page — built, considered, binned 16 August.** A working
  fetcher, view module and page existed for about an hour. Binned because
  the site gained nothing by re-listing the FSA's own register — no
  reading, no discovery, just a reformat — and the only distinctive rows
  would have chip-labelled local businesses over records as old as 2023
  that may long since be fixed. All downside, no story. The lesson worth
  keeping: the weekend's real wins surface what is published but UNREAD;
  a page must earn its place by reading at a scale a person cannot, not
  by mirroring a list that already has a search box. The fetcher lives on
  in ~/Developer/family-watch, which is private and never feeds this site.

## Known and accepted

- **CLS red in Cloudflare Web Analytics was a sample-size artefact, not a
  defect.** 28 August: the `/` path showed ~70% of loads in the poor bucket
  (>0.25) over 24 hours. Investigated to conclusion and nothing found wrong.
  Ruled out: unsized media (every img/iframe site-wide carries width and
  height, with `height:auto` and three `aspect-ratio` rules backing them);
  runtime insertion (no fetch, innerHTML, appendChild or classList.remove on
  the homepage — all ten `hidden` occurrences are `aria-hidden` on decorative
  glyphs); font blocking (the Google Fonts URL already carries
  `&display=swap`); and viewport, which was the leading theory and was wrong —
  mobile scored *better*. Lab, Slow 4G with cache disabled and scrolled to
  the footer: desktop CLS 0.03 / LCP 3.95 s (`img.tile-hero`), iPhone 12 Pro
  390x844 CLS 0.02 / LCP 1.70 s (`p.page-subtitle`). Both green; roughly
  eight times better than the field bar. The window held ~50 samples, mostly
  Ian's own devices mid-development. **Recheck the panel in a fortnight**
  once real visitors have generated real samples; if still red with a few
  hundred visits, it is real and the next place to look is Safari on iOS,
  untested and the likely browser for most of this audience.
- **Overhead polling can exhaust the Workers quota, and that risk is
  accepted.** The Cache API (`caches.default`) lives *inside* the Worker, so a
  hit saves the R2 read and the adsbdb subrequests but never the invocation —
  the `EDGE_TTL_S` comment in `functions/api/overhead.js` claiming "one shared
  read serves every visitor" is true of the read and false of the request.
  Cloudflare's newer Workers Caching product does sit in front, but its hits
  still count as requests, so nothing helps on a plan metered in requests.
  One poll, one invocation. At 5 s that is 720 per person-hour against an
  account-wide 100,000/day resetting 00:00 UTC — roughly 139 person-hours of
  watching. Not "half the town": 139 people for an hour, which one shared
  Facebook post could produce. **The quota is account-wide**, so exhausting it
  on `/overhead/` also stops `/api/fuel`, `/api/power`, both ingest endpoints
  and the `largs-metronome` and `largs-power` crons — the last being the one
  that matters, since the outage notice would go unfed until the small hours.
  Accepted anyway: at current traffic the threshold is far off, nothing breaks
  permanently or costs money, and both pages already degrade honestly (Error
  1027 returns without running the Function; `r.json()` throws, `failures`
  increments, and `showDown()` says "Live positions unavailable"). **15 s
  polling was rejected on the merits** — a jet covers a mile and a half in
  that time, the glyph jumps visibly on a 30 nm map, and the liveness is the
  feature. If it ever needs fixing the cheap answer is a session cap (~20
  minutes behind a "still watching?" button), because the failure mode is
  dwell time, not crowd size; the thorough answer is moving enrichment to the
  Pi and serving the finished object from a public R2 custom domain.


- **Scheduled builds are best-effort.** On 14 August only one of six hourly
  cron runs fired between 13:00 and 16:11 — GitHub deprioritises scheduled
  workloads under load. Nothing is broken; pushes always build immediately, and
  the board prints its real build time rather than claiming freshness. If it
  becomes chronic, the fix is moving the trigger to the Cloudflare Worker
  metronome, which is a real scheduler rather than a queue.
- **Node 20 deprecation.** GitHub is forcing `actions/cache@v4` and others onto
  Node 24. Nothing broken; a version bump is due.

## Deferred, with reasons

- **`loading="lazy"` on above-the-fold tile heroes.** All nine carry it, and
  on desktop the LCP element *is* a lazy hero at 3.95 s (amber). Lazy-loading
  defers an image until it nears the viewport; applied to one already visible
  on load it deprioritises exactly what the reader is waiting for. Mobile is
  unaffected — single column, LCP is the strapline at 1.70 s — so this is a
  wide-screen problem only. Fix is `eager` on the first row, but confirm which
  tiles are above the fold at desktop width first: the answer differs by
  viewport and the change is per-image.
- **744 kB of PNG heroes; the homepage is not finished until 5.97 s.** Nine
  files at 29-96 kB. AVIF through the pipeline already used for Alison's
  photos should take roughly two-thirds off. Will not move CLS, but it is the
  biggest single lever on how the site feels on a weak signal in Largs, which
  is the audience the project exists for. Keep PNG fallbacks; check the ink
  pipeline's flat tones survive AVIF at whatever quality is chosen, and
  referee at true size before committing.


- **Marine traffic map.** aisstream.io is the viable route — free websocket,
  key in GH secrets, a Worker on a short cron writing to KV. Aircraft is
  easier: adsb.lol / airplanes.live / adsb.fi, free REST, no key, ODbL. Would
  live at `/marine/` where JS is already allowed, with a link-out tile on Today.
- **Notice band placement.** Works and is styled, but sits between the page
  subtitle and the board's "Updated" line. Fine while dormant; revisit before a
  real notice goes up rather than under time pressure.
- **`bins.ics` calendar feed.** The rotation is already computed; publishing a
  feed is an afternoon and puts largs.org inside people's phone calendars.
  Highest retention per hour of work on the list.
- **Viking longship artwork.** Parked. Three pieces of Viking decoration would
  tip the site from "town site with Vikings" to "Viking-branded town site". If
  used, attach it to the Viking Festival listing rather than decorate with it.
- **School term dates** — every parent in Largs needs them, NAC publishes them,
  they are computable, and people check them repeatedly.
- **A local services directory** — chemist opening hours, the library, the
  recycling centre, GP surgeries. Largely static, checkable once a year, and
  the kind of thing people currently phone a neighbour about.
- **Event categories** (reuse the register's pagination pattern), **the
  directory** (~180 listings from the original site).

## Renewals and expiries

Dates that end things silently if missed. The TODO line is the record; the
calendar alert is the actual notice.

- **Fastmail Individual** — paid 28 Aug 2026, 36 months, **renews 28 Aug
  2029**. Login `largs@fastmail.com`. Carries hello@, events@, corrections@
  and letter@largs.scot, all delivering to one inbox. **Notice wanted 28 Jul
  2029.** If it lapses every published address stops receiving, including
  corrections@, which the editorial policy commits to answering.
- **largs.scot domain** — registered 27 Aug 2026, one-year term, **renews 27
  Aug 2027**. Registrar NOT RECORDED — fill in. Higher stakes than the
  mailbox and much nearer: if the domain lapses the site goes dark, every
  inbound link dies with it, and a released .scot can be registered by
  anyone. Confirm auto-renew is on and that the card on file outlives August
  2027. Calendar alert set.

## The design rules worth not breaking

Recorded here because each was decided with a reason and would otherwise be
undone by someone reasonable.

- **Colour on the Today board means something.** Status dots, the teal "now"
  dot, the bin's collection colour, and fills that depict a physical thing —
  water under the tide curve, sky under the daylight arc. A green ferry or an
  amber roadworks fill would each seem as reasonable as those did, and together
  they would break the one thing that makes the board legible.
- **Filters are build-time pages, not JavaScript.** Council corner and
  roadworks both generate a real page per filter, so the chips are plain links —
  bookmarkable, indexable, back-button correct, working with JS off.
- **The bin silhouette is vocabulary**, used at three sizes across the Today
  board and the bins page. Its colour is the information, and the colour's name
  always appears beside it.
- **Magnus appears on phones held portrait and at 900px and up**, and hides
  between 600 and 900 where the dateline shares his row.
- **Core Web Vitals: field data below roughly 200 samples in the window is
  noise.** Get the lab number before believing a red bar. DevTools ->
  Performance -> Local metrics gives CLS and the LCP element live; throttle to
  Slow 4G, tick Disable cache, and scroll to the bottom, because shifts
  accumulate over the page lifetime and an unscrolled run undercounts. Test
  both viewports — the LCP element differs between them. The older Frame
  Rendering Stats overlay shows frame rate and GPU only, not CLS.
