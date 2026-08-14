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

## Known and accepted

- **Scheduled builds are best-effort.** On 14 August only one of six hourly
  cron runs fired between 13:00 and 16:11 — GitHub deprioritises scheduled
  workloads under load. Nothing is broken; pushes always build immediately, and
  the board prints its real build time rather than claiming freshness. If it
  becomes chronic, the fix is moving the trigger to the Cloudflare Worker
  metronome, which is a real scheduler rather than a queue.
- **Node 20 deprecation.** GitHub is forcing `actions/cache@v4` and others onto
  Node 24. Nothing broken; a version bump is due.

## Deferred, with reasons

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
