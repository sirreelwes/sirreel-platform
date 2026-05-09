# RentalWorks Catalog Import — Applied

Run at: 2026-05-09T23:37:05.341Z

- Enriched (exact code match):           **0**
- Code-realigned + enriched (name match): **68**
- Auto-created (RW-only):                **95**
- Untouched SirReel-only:                **454**
- Rate conflicts logged but unchanged:    **68**

Auto-created rows have `categoryId=null` + `needsReview=true`. Admin assigns categories via the catalog UI; query is `SELECT * FROM inventory_items WHERE needs_review = true`.