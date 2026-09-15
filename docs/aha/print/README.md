# Printable one-pagers

`aha-for-fleet.html` is the print source for `AHA-warehouse-fleet.pdf` — US Letter, one page, mirrors `docs/aha/aha-for-fleet.md`.

Re-render after editing the HTML:

```bash
chromium --headless --disable-gpu --no-sandbox \
  --print-to-pdf=AHA-warehouse-fleet.pdf --no-pdf-header-footer \
  file://$PWD/aha-for-fleet.html
```

Any Chromium works. Keep it to one page — the `@page` margin and the 12pt base size are set for that, so check the page count before committing a new PDF.
