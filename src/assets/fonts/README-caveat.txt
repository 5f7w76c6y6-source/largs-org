Caveat (SIL Open Font Licence; see OFL-caveat.txt), static SemiBold (600)
instance of the variable font, 25 September 2026.

  caveat-600-tagline.woff2   3.7 KB  the file the site loads. Cut to the
                                     eight characters of the masthead line
                                     "…for you" (space . … f o r y u) and
                                     nothing else, because that line is the
                                     face's only job on the site and 52 KB on
                                     every first visit for eight letters is
                                     not honest. If the line ever changes,
                                     re-cut it — the letters missing from
                                     this file will fall back to the mono.
  caveat-600-latin.woff2    52 KB    the same face over the Latin range the
                                     other three fonts use. Not loaded by any
                                     page; kept here for print, the logo
                                     lock-up, or a future use on the site
                                     (add an @font-face if that day comes).

Re-cut (fontTools; brotli needed for woff2):
  pyftsubset Caveat-static-600.ttf --flavor=woff2 --layout-features='*' \
    --unicodes="U+0020,U+002E,U+2026,U+0066,U+006F,U+0072,U+0079,U+0075" \
    --output-file=caveat-600-tagline.woff2
The static 600 instance comes from the variable font with
fontTools.varLib.instancer (wght=600).
