# largs.org — open threads

Written 12 August 2026. Keep this in the repo root so it is impossible to lose.
Delete a line when it is genuinely done, not when it is planned.

## Must do before sharing the link with anyone

- [ ] **Referee pass on the register.** 63 entries across 16 meetings, none yet
      read against its source minute. The referee sheets are the checklist:
      `completed-2025-referee.md` and `register-2026-referee.md`. Work in
      meeting order, not register order — one set of minutes open at a time.
- [ ] **Elections entry needs the Chair's stated reason** about timescales
      putting back. It currently reads barer than the source and a reader can
      misconstrue it. This is the worked example for the whole pass.

## Newsletter

- [ ] **Wire the Largs Letter signup to a real provider.** Tonight's fix is a
      mailto — honest and working, but manual. Buttondown's free tier gives a
      form endpoint, an archive and clean export; Mailchimp is the alternative.
      The dead `<button type="button">` that did nothing is gone, but this is
      not finished until an address entered on the site lands somewhere by
      itself.
- [ ] First issue: no date committed. Content is not the constraint — audience
      is. Write it when there is someone to send it to.

## Council corner

- [ ] Replace the placeholder yoga entry in `events.json` with the real venue,
      time and contact.
- [ ] Three sets of 2025 minutes still missing: **March, October, December**.
      October and December are both recorded as having taken place. Linda Smith
      (Secretary) has the ask; NAC is the blockage. Nudge if nothing by ~19 Aug.
- [ ] Tell Linda the **May Street steps appear to be built** — ask whether it
      was ever minuted. The register cannot close it on an observation, but the
      Community Council can close it in their own record.

## At launch (largs.org handover)

- [ ] Delete `src/_headers` and its `addPassthroughCopy` line in
      `eleventy.config.js` to go indexable. Full steps are in DEPLOY.md.
- [ ] **Reconcile the domain pitch pack with actual intentions.** It currently
      commits in writing to "profits directed to local community groups". If
      the plan is personal income, that wording must change *before* the
      conversation, not after.

## Deferred, with reasons

- **Marine traffic map.** Wanted, but live AIS is client-side JS and every
  embeddable option is a third-party iframe with tracking and a commercial
  licence. Needs research into whether any AIS source permits a free community
  site to embed. Would live at `/marine/` where JS is already allowed, with a
  link-out tile on Today.
- **Notice band placement.** Works and is styled, but sits between the page
  subtitle and the board's "Updated" line. Fine while dormant; revisit before a
  real notice goes up rather than under time pressure.
- **`bins.ics` calendar feed.** The rotation is already computed; publishing a
  feed is an afternoon and puts largs.org inside people's phone calendars.
  Highest retention per hour of work on the list.
- **School term dates**, **event categories** (reuse the register's pagination
  pattern), **the directory** (~180 listings from the original site).

## Preview deployment (temporary)

- [ ] **Delete the `largs-preview` Cloudflare Pages project** once the
      Community Council conversation is had. It is a second live copy of
      the site on a neutral hostname, created 13 Aug 2026 so the Secretary
      could see it without the largs-org name giving away the domain
      intention. Noindexed, but a forgotten second copy is exactly the
      sort of thing that surfaces later.
- [ ] It is a **snapshot**, not a mirror — it does not rebuild. Redeploy
      with `npm run fetch && npm run build && npx wrangler pages deploy
      _site --project-name=largs-preview` if it needs to look current.
