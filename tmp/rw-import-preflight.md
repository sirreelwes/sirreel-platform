# RentalWorks Catalog Import — Pre-flight Report

Generated: 2026-05-09T23:28:51.431Z
RW physical items: **1797** · grouped masters: **163**
SirReel active inventory items: **522**

## Summary

| Bucket | Count | Action on apply |
|---|---:|---|
| A — Exact code match | 0 | Enrich description / specs / manufacturer / model / dimensions / replacementCost. Set rwId + rwLastSyncedAt. **Don't touch:** rates, aliases, department, categoryId, qtyOwned, code. |
| B — Name match (code realignment) | 68 | Same enrichment as A, **plus** rename SirReel `code` → RW `ICode`. |
| C — RW-only (auto-create) | 95 | Create new SirReel row with full RW data. `needsReview=true`, `aliases=[]`, `categoryId=null`, `department` set by keyword guess. |
| D — SirReel-only | 454 | No change. Listed below for visibility — could be platform-only items, recently retired in RW, or AI-rejected name matches. |
| E — Rate conflicts (informational) | 68 | **No change.** Rates are preserved. Listed for visibility into where SirReel and RW have drifted. |
| F — Enrichment coverage | 54 | Of 68 matched items, 54 would receive at least one new field. |

---

## A. Exact code matches

Total: **0**.

_(none — SirReel codes don't match RW ICodes anywhere; expected since SirReel's `code` field has historically held descriptions not RW codes.)_

## B. Name matches with mismatched codes (code-realignment candidates)

Total: **68**. On apply, SirReel `code` will be renamed to RW `ICode` for each.

| Current SirReel code → RW ICode | Item name | Match signal |
|---|---|---|
| `6K SPACE LIGHT (SOCAPEX) HEAD` → `104511` | 6K SPACE LIGHT (SOCAPEX) HEAD | name |
| `Honda 6500 Watt Generator` → `104425` | Honda 6500 Watt Generator | name |
| `Honda 2000 Watt Generator` → `103537` | Honda 2000 Watt Generator | name |
| `STAND - 3-RISER BEEFY BABY,STEEL` → `104465` | STAND - 3-RISER BEEFY BABY,STEEL | name |
| `STAND -3-RISER COMBO (Electric)` → `104464` | STAND -3-RISER COMBO (Electric) | name |
| `STAND - 3 RISER HI HI ROLLER` → `104468` | STAND - 3 RISER HI HI ROLLER | name |
| `STAND - 3 RISER HI ROLLER` → `104466` | STAND - 3 RISER HI ROLLER | name |
| `STAND - LOW COMBO W/4 1/2" GRIP HEAD` → `104486` | STAND - LOW COMBO W/4 1/2" GRIP HEAD | name |
| `RUNAWAY STAND "TURTLE"` → `104532` | RUNAWAY STAND "TURTLE" | name |
| `40" C-STAND` → `104462` | 40" C-STAND | tokens |
| `125/200W LTM PAR HEAD` → `104543` | 125/200W LTM PAR HEAD | name |
| `650W TWEENIE II HEAD - TYPE 4821` → `104469` | 650W TWEENIE II HEAD - TYPE 4821 | name |
| `ARRI 300W HEAD` → `104492` | ARRI 300W HEAD | name |
| `ARRI 150W HEAD` → `104536` | ARRI 150W HEAD | name |
| `750W ARRI LITE PLUS OPEN FACE` → `104497` | 750W ARRI LITE PLUS OPEN FACE | name |
| `MOLEPAR 1K HEAD - TYPE 2271` → `104481` | MOLEPAR 1K HEAD - TYPE 2271 | name |
| `ETC 750W SOURCE 4 LEKO HEAD` → `104488` | ETC 750W SOURCE 4 LEKO HEAD | name |
| `ASTRA 1X1 BI-COLOR - LITEPANEL` → `104534` | ASTRA 1X1 BI-COLOR - LITEPANEL | name |
| `KINO CELEB 200` → `104518` | KINO CELEB 200 | name |
| `1K VARIAC (AC) DIMMER` → `104542` | 1K VARIAC (AC) DIMMER | name |
| `2K VARIAC (AC) DIMMER` → `104493` | 2K VARIAC (AC) DIMMER | name |
| `ARRI SKYPANEL S60- LED` → `104460` | ARRI SKYPANEL S60- LED | name |
| `SUMO HEAD BI COLOR LED` → `102944` | SUMO HEAD BI COLOR LED | name |
| `MINI MOLE HEAD - TYPE 2801 - INKIE` → `104476` | MINI MOLE HEAD - TYPE 2801 - INKIE | name |
| `MIDGET MOLE 200W HEAD - TYPE 2351` → `104479` | MIDGET MOLE 200W HEAD - TYPE 2351 | name |
| `300W BETWEENIE HEAD - TYPE 3131` → `104519` | 300W BETWEENIE HEAD - TYPE 3131 | name |
| `Air Conditioner - 1.5 Ton` → `104400` | Air Conditioner - 1.5 Ton | name |
| `2' X 6' STEEL DECK` → `104414` | 2' X 6' STEEL DECK | name |
| `2' X 4' STEEL DECK` → `104413` | 2' X 4' STEEL DECK | name |
| `2' X 8' STEEL DECK` → `104415` | 2' X 8' STEEL DECK | name |
| `DANA DOLLY` → `104513` | DANA DOLLY | name |
| `Air Scrubber (750 CFM)` → `104540` | Air Scrubber (750 CFM) | name |
| `Air Scrubber (550 CFM)` → `104529` | Air Scrubber (550 CFM) | name |
| `STIRRUP HANGER 3' TO 6'` → `104515` | STIRRUP HANGER 3' TO 6' | name |
| `STIRRUP HANGER 5' TO 10'` → `104512` | STIRRUP HANGER 5' TO 10' | name |
| `Bullhorn` → `104407` | Bullhorn | name |
| `Coffee Maker - 100 Cup` → `104408` | Coffee Maker - 100 Cup | name |
| `DF50 Hazer (Oil Based)` → `104418` | DF50 Hazer (Oil Based) | name |
| `Speaker - QSC K12` → `104405` | Speaker - QSC K12 | name |
| `Ladder - 10'` → `104421` | Ladder - 10' | name |
| `Ladder - 12'` → `104422` | Ladder - 12' | name |
| `Ladder - 14'` → `104423` | Ladder - 14' | name |
| `Ladder - 6'` → `104420` | Ladder - 6' | name |
| `Ladder - 8'` → `103179` | Ladder - 8' | name |
| `LITEMAT 2 SERIES 2 COMPLETE` → `104508` | LITEMAT 2 SERIES 2 COMPLETE | name |
| `LITEMAT 4 PLUS HYBRID COMPLETE` → `104510` | LITEMAT 4 PLUS HYBRID COMPLETE | name |
| `LITEMAT 4  SERIES 2 COMPLETE` → `104509` | LITEMAT 4  SERIES 2 COMPLETE | name |
| `Dolly - Magliner Jr.` → `104410` | Dolly - Magliner Jr. | name |
| `Dolly - Magliner Sr.` → `104409` | Dolly - Magliner Sr. | name |
| `10 Gallon Mister` → `104401` | 10 Gallon Mister | tokens |
| `Heater - Mobile Propane` → `103845` | Heater - Mobile Propane | name |
| `Rosco Vapour Fogger` → `104455` | Rosco Vapour Fogger | tokens |
| `Wardrobe Steamer` → `103856` | Wardrobe Steamer | name |
| `UTAH - SPEAKER,GEMINI 115BT (Bluetooth)` → `104406` | UTAH - SPEAKER,GEMINI 115BT (Bluetooth) | name |
| `Rosco V-Hazer (Water based)` → `103859` | Rosco V-Hazer (Water based) | name |
| `STAND - 3-RISER COMBO W/ 4 1/2" GRIP HEAD` → `104498` | STAND - 3-RISER COMBO W/ 4 1/2" GRIP HEAD | name |
| `1K MICKEY MOLE HEAD - TYPE 4081` → `104480` | 1K MICKEY MOLE HEAD - TYPE 4081 | name |
| `Dolly - Magliner Sr. with Shelf` → `104593` | Dolly - Magliner Sr. with Shelf | name |
| `Honda 3000 Watt Generator` → `104424` | Honda 3000 Watt Generator | name |
| `4' X 8' STEEL DECK` → `104411` | 4' X 8' STEEL DECK | name |
| `STIRRUP HANGER 4' TO 8'` → `104516` | STIRRUP HANGER 4' TO 8' | name |
| `DF50 Hazer (Water Based)` → `104417` | DF50 Hazer (Water Based) | name |
| `Fan - Stage 32"` → `104506` | Fan - Stage 32" | name |
| `Make Up Mirror, Half (Table Top)` → `104434` | Make Up Mirror, Half (Table Top) | name |
| `Ladder - 4'` → `104454` | Ladder - 4' | name |
| `Make Up Mirror, Rolling` → `104433` | Make Up Mirror, Rolling | name |
| `Motorola CP200  UHF Radio (Analog)` → `103733` | Motorola CP200  UHF Radio (Analog) | name |
| `LOW C-STAND - 20"` → `104463` | LOW C-STAND - 20" | name |

## C. RW-only items (will be auto-created)

Total: **95**. New SirReel rows created with `needsReview=true`. categoryId stays NULL pending manual assignment.

| RW ICode | Description | Manufacturer | Suggested dept | RW DailyRate | RW WeeklyRate | Active qty |
|---|---|---|---|---:|---:|---:|
| `105141` | Dewalt - Flexvolt Charger (4 Port) | Dewalt | GE | $0.00 | $0.00 | 1 |
| `104459` | Dewalt - Flexvolt Charger (Dual) | Dewalt | GE | $0.00 | $0.00 | 5 |
| `104457` | Worklight - Battery Powered (Dewalt) | Dewalt | GE | $25.00 | $75.00 | 26 |
| `104430` | Leaf Blower - Plug In | — | PRO_SUPPLIES | $15.00 | $45.00 | 4 |
| `104458` | Dewalt - Flexvolt Charger | — | GE | $0.00 | $0.00 | 11 |
| `105121` | DOORWAY DOLLY (NON SKATE) | — | PRO_SUPPLIES | $125.00 | $0.00 | 2 |
| `105120` | DOORWAY DOLLY (SKATE) | — | PRO_SUPPLIES | $125.00 | $0.00 | 2 |
| `104388` | Caravan Canopy -10' x 10', Black | — | PRO_SUPPLIES | $30.00 | $90.00 | 50 |
| `105020` | Internet - T-Mobile MiFi (5G) | — | PRO_SUPPLIES | $99.00 | $297.00 | 20 |
| `104387` | Motorola CP200  UHF Radio (Digital) | — | COMMUNICATIONS | $10.00 | $30.00 | 91 |
| `104997` | Milwaukee - Rapid Charger | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104432` | Leaf Blower - Battery Powered (Milwaukee M18) | — | EXPENDABLES | $25.00 | $75.00 | 1 |
| `104563` | 4K "SMALL" ZIP SOFTLITE | — | PRO_SUPPLIES | $0.00 | $0.00 | 2 |
| `104562` | 4K "ZIP" LIGHT EGGCRATE | — | GE | $0.00 | $0.00 | 5 |
| `104561` | 2K - "ZIP" LIGHT EGG CRATE | — | GE | $0.00 | $0.00 | 12 |
| `103013` | FLUOTEC STUDIO 120 HEAD | — | PRO_SUPPLIES | $0.00 | $0.00 | 2 |
| `104560` | VEGALUX 200 HEAD DAYLIGHT | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104559` | VEGALUX 200 HEAD TUNGSTEN | — | GE | $0.00 | $0.00 | 11 |
| `103908` | VEGALUX 300 10" BI-COLOR | — | PRO_SUPPLIES | $0.00 | $0.00 | 12 |
| `104558` | KINO - 4 BANK MEGA BALLAST | — | GE | $0.00 | $0.00 | 4 |
| `104557` | KINO - 2' FOUR BANK HEAD | — | GE | $0.00 | $0.00 | 6 |
| `104556` | KINO - 2' DOUBLE BANK HEAD | — | GE | $0.00 | $0.00 | 3 |
| `104555` | KINO - 2' SINGLE BANK HEAD | — | GE | $0.00 | $0.00 | 7 |
| `104554` | KINO - 4' FOUR BANK HEAD | — | GE | $0.00 | $0.00 | 4 |
| `104553` | KINO - 4' DOUBLE BANK HEAD | — | GE | $0.00 | $0.00 | 5 |
| `104552` | KINO - 4' SINGLE BANK HEAD | — | GE | $0.00 | $0.00 | 10 |
| `104551` | KINO- 2 BANK BALLAST | — | GE | $0.00 | $0.00 | 8 |
| `104549` | VIDEO PRO SPEED RING 6 1/4" | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104547` | QUARTZ SPEED RING 18" | — | PRO_SUPPLIES | $0.00 | $0.00 | 2 |
| `104550` | VIDEO PRO SPEED RING 5 1/4" | — | PRO_SUPPLIES | $0.00 | $0.00 | 2 |
| `104546` | QUARTZ SPEED RING 9" | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104548` | VIDEO PRO SPEED RING 7 1/4" | — | PRO_SUPPLIES | $0.00 | $0.00 | 4 |
| `104545` | QUARTZ SPEED RING 13 1/2" | — | PRO_SUPPLIES | $0.00 | $0.00 | 7 |
| `104544` | 60 AMP GANG BOX | — | PRO_SUPPLIES | $12.00 | $12.00 | 3 |
| `104541` | Bose Sound Link Flex (Bluetooth) | — | PRO_SUPPLIES | $35.00 | $105.00 | 2 |
| `104539` | 12K DIMMER (DMX) | — | GE | $0.00 | $0.00 | 2 |
| `104538` | 650 VARIAC DIMMER | — | GE | $0.00 | $0.00 | 2 |
| `104537` | ARRILITE 5K HEAD | — | PRO_SUPPLIES | $0.00 | $0.00 | 2 |
| `104535` | 9 LIGHT FAY HEAD - 5850 WATT | — | GE | $75.00 | $0.00 | 2 |
| `104533` | OPTICAL SPLITTER 5-WAY DMX | — | PRO_SUPPLIES | $100.00 | $0.00 | 2 |
| `104531` | STAND - AVENGER LOW CRANK | — | GE | $100.00 | $0.00 | 2 |
| `104528` | Air Scrubber (500 CFM) | — | PRO_SUPPLIES | $75.00 | $225.00 | 1 |
| `104527` | 6K Barger Baglite 6 Light | — | GE | $0.00 | $0.00 | 1 |
| `104526` | KINO FLO IMAGE 80 - CASE | — | GE | $0.00 | $0.00 | 1 |
| `104525` | KINO FLO IMAGE 80 COMPLETE | — | GE | $0.00 | $0.00 | 1 |
| `104524` | Joker 400W Bug - Case | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104523` | Joker 400W Bug Ballast | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104522` | Joker 400W Bug Head | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104521` | 800W KF5600 JOKER / SOURCE 4 LEKO | — | PRO_SUPPLIES | $350.00 | $0.00 | 1 |
| `104520` | Astera - Titan Charger Case (8-Place) | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104517` | ANTON BAUER - DUAL CHARGER 2702 | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104507` | ASTERA BOX - ART7 RX/TX | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `102993` | 100 AMP DISTRO BOX (LUNCH BOX) | — | GE | $35.00 | $0.00 | 42 |
| `104505` | 1200 AMP SOCAPEX DISTRO(220V) | — | GE | $400.00 | $0.00 | 2 |
| `104504` | 1200 AMP DISTRO(220V) | — | GE | $400.00 | $0.00 | 2 |
| `104503` | 900 AMP DISTRO | — | GE | $350.00 | $0.00 | 1 |
| `104502` | 600 AMP DISTRO | — | GE | $275.00 | $0.00 | 2 |
| `104500` | 5K SKYPAN OPEN FACE | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104499` | 1K BABY "ZIP" SOFTLITE | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104496` | 2K ARRI LITE PLUS OPEN FACE | — | PRO_SUPPLIES | $85.00 | $0.00 | 4 |
| `104495` | KINO FLO IMAGE 87 COMPLETE | — | GE | $0.00 | $0.00 | 4 |
| `104494` | 4K BABY "ZIP" SOFTLITE | — | PRO_SUPPLIES | $0.00 | $0.00 | 4 |
| `104491` | QUARTZ SPEED RING 10" | — | PRO_SUPPLIES | $0.00 | $0.00 | 9 |
| `104490` | ARRI SKYPANEL S60/S120 - PSU | — | PRO_SUPPLIES | $0.00 | $0.00 | 10 |
| `104489` | 100 AMP GANG BOX | — | PRO_SUPPLIES | $25.00 | $0.00 | 10 |
| `104487` | PREEMIE BABY STAND | — | GE | $10.00 | $0.00 | 12 |
| `104485` | 1K PARCAN 64 | — | PRO_SUPPLIES | $0.00 | $0.00 | 13 |
| `104484` | 2K BABY "ZIP" SOFTLITE | — | PRO_SUPPLIES | $0.00 | $0.00 | 13 |
| `104483` | BABY 10K  MOLE HEAD | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104482` | 2K MIGHTY MOLE HEAD - TYPE 4091 | — | PRO_SUPPLIES | $0.00 | $0.00 | 1 |
| `104478` | 2K 8" JUNIOR MOLE HEAD | — | PRO_SUPPLIES | $0.00 | $0.00 | 4 |
| `104477` | BABY 2K  MOLE HEAD | — | PRO_SUPPLIES | $0.00 | $0.00 | 7 |
| `104475` | 5K MOLE BABY SENIOR | — | PRO_SUPPLIES | $140.00 | $0.00 | 5 |
| `104474` | ETC SOURCE 4 50 DEGREE LENS TUBE | — | GE | $25.00 | $0.00 | 6 |
| `104473` | ETC SOURCE 4 26 DEGREE LENS TUBE | — | GE | $25.00 | $0.00 | 14 |
| `104472` | ETC SOURCE 4 19 DEGREE LENS TUBE | — | GE | $25.00 | $0.00 | 14 |
| `104471` | KINO - 4 BANK BALLAST | — | GE | $0.00 | $0.00 | 14 |
| `104470` | ETC SOURCE 4 36 DEGREE LENS TUBE | — | GE | $25.00 | $0.00 | 15 |
| `104402` | Internet - Verizon Mifi | — | PRO_SUPPLIES | $99.00 | $297.00 | 5 |
| `104467` | 1K HOUSEHOLD DIMMER / HAND | — | GE | $10.00 | $0.00 | 20 |
| `104461` | ASTERA 4' TITAN LED TUBE | — | PRO_SUPPLIES | $0.00 | $0.00 | 8 |
| `104456` | Worklight - Battery Powered (Pelican) | — | EXPENDABLES | $25.00 | $75.00 | 2 |
| `104435` | Mirror - 6' Free Standing | — | PRO_SUPPLIES | $12.50 | $37.50 | 8 |
| `104419` | Fan - Reel Effects 2 (RE 2) | — | PRO_SUPPLIES | $65.00 | $195.00 | 4 |
| `104390` | Caravan Canopy -10' x 10', White | — | PRO_SUPPLIES | $30.00 | $90.00 | 4 |
| `104389` | Caravan Canopy -10' x 10', Blue | — | PRO_SUPPLIES | $30.00 | $90.00 | 11 |
| `104428` | Caravan Canopy - 8' x 8', White | — | PRO_SUPPLIES | $25.00 | $75.00 | 2 |
| `104396` | Caravan Canopy - 10' x 20, Blue | — | PRO_SUPPLIES | $55.00 | $165.00 | 16 |
| `104395` | Caravan Canopy - 10' x 20', Black | — | PRO_SUPPLIES | $55.00 | $165.00 | 5 |
| `104393` | Caravan Canopy - 10' x 15', White | — | PRO_SUPPLIES | $50.00 | $150.00 | 3 |
| `104392` | Caravan Canopy - 10' x 15', Blue | — | PRO_SUPPLIES | $40.00 | $120.00 | 14 |
| `104391` | Caravan Canopy - 10' x 15', Black | — | PRO_SUPPLIES | $40.00 | $120.00 | 12 |
| `104404` | Boom Box (Dewalt) | — | GE | $15.00 | $45.00 | 6 |
| `104412` | 4' X 4' STEEL DECK | — | PRO_SUPPLIES | $0.00 | $0.00 | 3 |
| `104427` | 1st Aid Kit (50 Person) | — | PRO_SUPPLIES | $25.00 | $75.00 | 12 |

## D. SirReel-only items

Total: **454**. No change — listed for visibility.

| SirReel code | Description | Department | Daily | Weekly |
|---|---|---|---:|---:|
| `100A 220V BATES CABLE EXTENSION 25'` | 100A 220V BATES CABLE EXTENSION 25' | GE | $0.00 | $17.00 |
| `4 WIRE CAMLOK CABLE BANDED 25'` | 4 WIRE CAMLOK CABLE BANDED 25' | GE | $0.00 | $20.00 |
| `60A BATES CABLE EXTENSION 25'` | 60A BATES CABLE EXTENSION 25' | GE | $0.00 | $13.00 |
| `SOCAPEX CABLE 25'` | SOCAPEX CABLE 25' | GE | $0.00 | $18.00 |
| `25' EDISON CABLE (STINGER)` | 25' EDISON CABLE (STINGER) | GE | $0.00 | $7.00 |
| `100A BATES CABLE EXTENSION 50'` | 100A BATES CABLE EXTENSION 50' | GE | $0.00 | $22.00 |
| `60A BATES CABLE EXTENSION 50'` | 60A BATES CABLE EXTENSION 50' | GE | $0.00 | $17.00 |
| `100A 220V BATES CABLE EXTENSION 50'` | 100A 220V BATES CABLE EXTENSION 50' | GE | $0.00 | $22.00 |
| `UTAH - RAMP (2-PC.) ADJUSTABLE LENGTH,` | UTAH - RAMP (2-PC.) ADJUSTABLE LENGTH, | PRO_SUPPLIES | $0.00 | $30.00 |
| `4 WIRE CAMLOK CABLE BANDED 50'` | 4 WIRE CAMLOK CABLE BANDED 50' | GE | $0.00 | $43.00 |
| `5' DMX 5-PIN CABLE` | 5' DMX 5-PIN CABLE | GE | $0.00 | $6.00 |
| `25' DMX 5-PIN CABLE` | 25' DMX 5-PIN CABLE | GE | $0.00 | $11.00 |
| `50' DMX 5-PIN CABLE` | 50' DMX 5-PIN CABLE | GE | $0.00 | $13.00 |
| `100' DMX 5-PIN CABLE` | 100' DMX 5-PIN CABLE | GE | $0.00 | $17.00 |
| `SOCAPEX CABLE 100'` | SOCAPEX CABLE 100' | GE | $0.00 | $35.00 |
| `SOCAPEX CABLE 50'` | SOCAPEX CABLE 50' | GE | $0.00 | $26.00 |
| `SAFETY CABLE 3' (STEEL)` | SAFETY CABLE 3' (STEEL) | GE | $0.00 | $3.00 |
| `SOLID CHEESEBORO CLAMP (STEEL)` | SOLID CHEESEBORO CLAMP (STEEL) | GE | $0.00 | $9.00 |
| `SWIVEL CHEESEBORO CLAMP (STEEL)` | SWIVEL CHEESEBORO CLAMP (STEEL) | GE | $0.00 | $9.00 |
| `GRID CLAMP W/ BABY RECEIVER` | GRID CLAMP W/ BABY RECEIVER | PRO_SUPPLIES | $0.00 | $9.00 |
| `GRID CLAMP W/EAR` | GRID CLAMP W/EAR | PRO_SUPPLIES | $0.00 | $9.00 |
| `CARDELLINI CLAMP END JAW` | CARDELLINI CLAMP END JAW | GE | $0.00 | $13.00 |
| `SPEED C-CLAMP 1ﬂ` | SPEED C-CLAMP 1ﬂ | PRO_SUPPLIES | $0.00 | $13.00 |
| `4"C-CLAMP W/PIN` | 4"C-CLAMP W/PIN | PRO_SUPPLIES | $0.00 | $8.00 |
| `6"C-CLAMP W/PIN` | 6"C-CLAMP W/PIN | PRO_SUPPLIES | $0.00 | $8.00 |
| `10ﬂ C-CLAMP W/PIN` | 10ﬂ C-CLAMP W/PIN | PRO_SUPPLIES | $0.00 | $9.00 |
| `12" C-CLAMP W/PIN` | 12" C-CLAMP W/PIN | PRO_SUPPLIES | $0.00 | $9.00 |
| `4ﬂ C-CLAMP W/JR. RECEIVER` | 4ﬂ C-CLAMP W/JR. RECEIVER | PRO_SUPPLIES | $0.00 | $8.00 |
| `6"C-CLAMP W/JR. RECEIVER` | 6"C-CLAMP W/JR. RECEIVER | PRO_SUPPLIES | $0.00 | $8.00 |
| `10ﬂ C-CLAMP W/JR. RECEIVER` | 10ﬂ C-CLAMP W/JR. RECEIVER | PRO_SUPPLIES | $0.00 | $9.00 |
| `BEADBOARD CLAMP HOLDER - DUCKBILL` | BEADBOARD CLAMP HOLDER - DUCKBILL | PRO_SUPPLIES | $0.00 | $7.00 |
| `GATOR GRIP CLAMP W/PIN` | GATOR GRIP CLAMP W/PIN | GE | $0.00 | $4.00 |
| `LED TUBE POWER ADAPTER TO EDISON - SINGLE` | LED TUBE POWER ADAPTER TO EDISON - SINGLE | PRO_SUPPLIES | $0.00 | $6.00 |
| `Honda 7000 Watt Generator` | Honda 7000 Watt Generator | GE | $0.00 | $675.00 |
| `Wireless Internet, Mifi Hotspot (AT&T)` | Wireless Internet, Mifi Hotspot (AT&T) | COMMUNICATIONS | $0.00 | $325.00 |
| `Wireless Internet, MiFi Hotspot (Verizon)` | Wireless Internet, MiFi Hotspot (Verizon) | COMMUNICATIONS | $0.00 | $325.00 |
| `Pressure Washer, Plug In` | Pressure Washer, Plug In | PRO_SUPPLIES | $0.00 | $120.00 |
| `UTAH - WIRELESS INTERNET, MIFI HOTSPOT (VERIZON)` | UTAH - WIRELESS INTERNET, MIFI HOTSPOT (VERIZON) | COMMUNICATIONS | $0.00 | $325.00 |
| `UTAH - PRESSURE WASHER, PLUG IN` | UTAH - PRESSURE WASHER, PLUG IN | PRO_SUPPLIES | $0.00 | $120.00 |
| `12' X 12' BLACK/WHITE GRIFFOLYN RAG` | 12' X 12' BLACK/WHITE GRIFFOLYN RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' CHINA (1/2) SILK RAG` | 12' X 12' CHINA (1/2) SILK RAG | GE | $0.00 | $75.00 |
| `12' X 12' FULL GRID RAG` | 12' X 12' FULL GRID RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' LITE (1/2) GRID RAG` | 12' X 12' LITE (1/2) GRID RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' QUARTER GRID RAG` | 12' X 12' QUARTER GRID RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' SOLID BLACK RAG` | 12' X 12' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' SINGLE NET RAG` | 12' X 12' SINGLE NET RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 20' FULL GRID RAG` | 12' X 20' FULL GRID RAG | PRO_SUPPLIES | $0.00 | $110.00 |
| `12' X 20' LITE (1/2) GRID RAG` | 12' X 20' LITE (1/2) GRID RAG | PRO_SUPPLIES | $0.00 | $110.00 |
| `12' X 20' QUARTER GRID RAG` | 12' X 20' QUARTER GRID RAG | PRO_SUPPLIES | $0.00 | $110.00 |
| `12' X 20' SOLID BLACK RAG` | 12' X 20' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $100.00 |
| `12' X 20' ULTRABOUNCE RAG` | 12' X 20' ULTRABOUNCE RAG | PRO_SUPPLIES | $0.00 | $100.00 |
| `12' X 30' SOLID BLACK RAG` | 12' X 30' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $150.00 |
| `18" X 24"  EMPTY FRAMES` | 18" X 24"  EMPTY FRAMES | PRO_SUPPLIES | $0.00 | $5.00 |
| `18 "X 24"  SILK FLAG` | 18 "X 24"  SILK FLAG | GE | $0.00 | $5.00 |
| `18" X 24" SINGLE NET FLAG` | 18" X 24" SINGLE NET FLAG | GE | $0.00 | $5.00 |
| `18" X 24" SOLID FLAG` | 18" X 24" SOLID FLAG | GE | $0.00 | $5.00 |
| `18" X 48" SOLID CUTTER` | 18" X 48" SOLID CUTTER | PRO_SUPPLIES | $0.00 | $10.00 |
| `20' X 20' FULL GRID RAG (NOISY)` | 20' X 20' FULL GRID RAG (NOISY) | PRO_SUPPLIES | $0.00 | $125.00 |
| `20' X 20' LITE (1/2) GRID CLOTH RAG` | 20' X 20' LITE (1/2) GRID CLOTH RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `20' X 20' QUARTER GRID CLOTH RAG` | 20' X 20' QUARTER GRID CLOTH RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `20' X 20' SOLID BLACK RAG` | 20' X 20' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `20' X 20' SINGLE NET RAG` | 20' X 20' SINGLE NET RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `24" X 36" DOUBLE NET FLAG` | 24" X 36" DOUBLE NET FLAG | GE | $0.00 | $5.50 |
| `24" X 36"  EMPTY FRAMES` | 24" X 36"  EMPTY FRAMES | PRO_SUPPLIES | $0.00 | $5.50 |
| `24" X 36" SINGLE NET FLAG` | 24" X 36" SINGLE NET FLAG | GE | $0.00 | $5.50 |
| `24" X 48" SINGLE MEAT AXE T-FLAG` | 24" X 48" SINGLE MEAT AXE T-FLAG | GE | $0.00 | $12.00 |
| `24"  X 60" SOLID CUTTER` | 24"  X 60" SOLID CUTTER | PRO_SUPPLIES | $0.00 | $10.00 |
| `24" X 72" SOLID CUTTER` | 24" X 72" SOLID CUTTER | PRO_SUPPLIES | $0.00 | $15.00 |
| `4' X 4' BLEACHED MUSLIN FLAG` | 4' X 4' BLEACHED MUSLIN FLAG | GE | $0.00 | $10.00 |
| `4' X 4' BLACK WHITE GRIFF FLAG` | 4' X 4' BLACK WHITE GRIFF FLAG | GE | $0.00 | $11.00 |
| `4' X 4' FULL GRID RAG` | 4' X 4' FULL GRID RAG | PRO_SUPPLIES | $0.00 | $15.00 |
| `4' X 4' 1/2 GRID RAG` | 4' X 4' 1/2 GRID RAG | PRO_SUPPLIES | $0.00 | $15.00 |
| `4' X 4' 1/2 SOFT FROST RAG` | 4' X 4' 1/2 SOFT FROST RAG | PRO_SUPPLIES | $0.00 | $15.00 |
| `4' X 4' POLY SILK RAG` | 4' X 4' POLY SILK RAG | GE | $0.00 | $15.00 |
| `4' X 4' UNBLEACHED MUSLIN FLAG` | 4' X 4' UNBLEACHED MUSLIN FLAG | GE | $0.00 | $10.00 |
| `48" X 48" DOUBLE NET FLAG` | 48" X 48" DOUBLE NET FLAG | GE | $0.00 | $10.00 |
| `48" X 48" EMPTY FRAME` | 48" X 48" EMPTY FRAME | GE | $0.00 | $10.00 |
| `48" X 48" SINGLE NET FLAG` | 48" X 48" SINGLE NET FLAG | GE | $0.00 | $10.00 |
| `48' X 48' SOLID FLAG` | 48' X 48' SOLID FLAG | GE | $0.00 | $10.00 |
| `DOT & FINGER BAG` | DOT & FINGER BAG | PRO_SUPPLIES | $0.00 | $6.00 |
| `1' SPEEDRAIL PIPE 1-1/4"` | 1' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $2.00 |
| `2' SPEEDRAIL PIPE 1-1/4"` | 2' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $3.00 |
| `3' SPEEDRAIL PIPE 1-1/4"` | 3' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $4.00 |
| `4' SPEEDRAIL PIPE 1-1/4"` | 4' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $5.00 |
| `6' SPEEDRAIL PIPE 1-1/4"` | 6' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $7.00 |
| `8' SPEEDRAIL PIPE 1-1/4"` | 8' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $9.00 |
| `10' SPEEDRAIL PIPE 1-1/4"` | 10' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $11.00 |
| `12' SPEEDRAIL PIPE 1-1/4"` | 12' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $13.00 |
| `20' SPEEDRAIL PIPE 1-1/4"` | 20' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $22.00 |
| `APPLE BOX - QUARTER` | APPLE BOX - QUARTER | GE | $0.00 | $6.00 |
| `APPLE BOX - PANCAKE` | APPLE BOX - PANCAKE | GE | $0.00 | $6.00 |
| `6' X 6' BLEACHED MUSLIN RAG` | 6' X 6' BLEACHED MUSLIN RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' CHROMA GREEN RAG` | 6' X 6' CHROMA GREEN RAG | PRO_SUPPLIES | $0.00 | $50.00 |
| `6' X 6' CHINA SILK RAG` | 6' X 6' CHINA SILK RAG | GE | $0.00 | $35.00 |
| `6' X 6' DIGI GREEN RAG` | 6' X 6' DIGI GREEN RAG | PRO_SUPPLIES | $0.00 | $50.00 |
| `6' X 6' DOUBLE NET RAG` | 6' X 6' DOUBLE NET RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' FULL GRID RAG` | 6' X 6' FULL GRID RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' GOLD GRIFFLON RAG` | 6' X 6' GOLD GRIFFLON RAG | PRO_SUPPLIES | $0.00 | $40.00 |
| `APPLE BOX - HALF` | APPLE BOX - HALF | GE | $0.00 | $6.00 |
| `6' X 6' 1/2 SOFT FROST RAG` | 6' X 6' 1/2 SOFT FROST RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' QUARTER GRID RAG` | 6' X 6' QUARTER GRID RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' QUARTER SILK RAG` | 6' X 6' QUARTER SILK RAG | GE | $0.00 | $35.00 |
| `6' X 6' SOLID BLACK RAG` | 6' X 6' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' SILVER & GOLD CHECKER RAG` | 6' X 6' SILVER & GOLD CHECKER RAG | PRO_SUPPLIES | $0.00 | $40.00 |
| `6' X 6' SILVER GRIFFLON RAG` | 6' X 6' SILVER GRIFFLON RAG | PRO_SUPPLIES | $0.00 | $40.00 |
| `6' X 6' SINGLE NET RAG` | 6' X 6' SINGLE NET RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' ULTRABOUNCE RAG` | 6' X 6' ULTRABOUNCE RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' UNBLEACHED MUSLIN RAG` | 6' X 6' UNBLEACHED MUSLIN RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 8' FORREST NET` | 6' X 8' FORREST NET | PRO_SUPPLIES | $0.00 | $60.00 |
| `MAFER CLAMP` | MAFER CLAMP | PRO_SUPPLIES | $0.00 | $7.00 |
| `BIG BEN CLAMP` | BIG BEN CLAMP | PRO_SUPPLIES | $0.00 | $9.00 |
| `18ﬂ FURNITURE CLAMP` | 18ﬂ FURNITURE CLAMP | PRO_SUPPLIES | $0.00 | $7.00 |
| `24ﬂ FURNITURE CLAMP` | 24ﬂ FURNITURE CLAMP | PRO_SUPPLIES | $0.00 | $8.00 |
| `PUTTY KNIFE W/PIN` | PUTTY KNIFE W/PIN | PRO_SUPPLIES | $0.00 | $6.00 |
| `CHAIN VISE GRIP` | CHAIN VISE GRIP | GE | $0.00 | $8.00 |
| `2 1/2" GRIP HEAD` | 2 1/2" GRIP HEAD | GE | $0.00 | $5.00 |
| `JR. OFFSET ARM` | JR. OFFSET ARM | PRO_SUPPLIES | $0.00 | $9.00 |
| `BABY OFFSET ARM` | BABY OFFSET ARM | PRO_SUPPLIES | $0.00 | $9.00 |
| `JR. PIPE HANGER - CLAMP` | JR. PIPE HANGER - CLAMP | PRO_SUPPLIES | $0.00 | $8.00 |
| `BABY PIPE HANGER - CLAMP` | BABY PIPE HANGER - CLAMP | PRO_SUPPLIES | $0.00 | $7.00 |
| `DROP CEILING CLIP W/PIN - SCISSOR` | DROP CEILING CLIP W/PIN - SCISSOR | PRO_SUPPLIES | $0.00 | $6.00 |
| `8' X 8' BLEACHED MUSLIN RAG` | 8' X 8' BLEACHED MUSLIN RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' CHINA SILK RAG` | 8' X 8' CHINA SILK RAG | GE | $0.00 | $45.00 |
| `8' X 8' DOUBLE NET RAG` | 8' X 8' DOUBLE NET RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' GOLD LAME RAG` | 8' X 8' GOLD LAME RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' 1/2 SOFT FROST RAG` | 8' X 8' 1/2 SOFT FROST RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' POLY SILK RAG` | 8' X 8' POLY SILK RAG | GE | $0.00 | $45.00 |
| `8' X 8' SOLID BLACK RAG` | 8' X 8' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' SILVER GOLD CHECKER RAG` | 8' X 8' SILVER GOLD CHECKER RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' SILVER LAME RAG` | 8' X 8' SILVER LAME RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' ULTRABOUNCE RAG` | 8' X 8' ULTRABOUNCE RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' UNBLEACHED MUSLIN RAG` | 8' X 8' UNBLEACHED MUSLIN RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `BABY GRID CLAMPS` | BABY GRID CLAMPS | PRO_SUPPLIES | $0.00 | $3.00 |
| `APPLE BOX - FULL (CHROMA GREEN)` | APPLE BOX - FULL (CHROMA GREEN) | GE | $0.00 | $24.00 |
| `Standard Boom Box` | Standard Boom Box | PRO_SUPPLIES | $0.00 | $30.00 |
| `FLEX ARM` | FLEX ARM | PRO_SUPPLIES | $0.00 | $8.00 |
| `#1 GRIP CLIP` | #1 GRIP CLIP | GE | $0.00 | $3.00 |
| `#2 GRIP CLIP` | #2 GRIP CLIP | GE | $0.00 | $3.00 |
| `#3 GRIP CLIP` | #3 GRIP CLIP | GE | $0.00 | $4.00 |
| `JR BOOM ARM` | JR BOOM ARM | PRO_SUPPLIES | $0.00 | $20.00 |
| `MEAT AXE` | MEAT AXE | PRO_SUPPLIES | $0.00 | $11.00 |
| `MENACE ARM KIT` | MENACE ARM KIT | PRO_SUPPLIES | $0.00 | $40.00 |
| `BOLT ON PIPE CLAMP` | BOLT ON PIPE CLAMP | PRO_SUPPLIES | $0.00 | $3.00 |
| `UTAH - 25 LB. SANDBAG` | UTAH - 25 LB. SANDBAG | GE | $0.00 | $9.00 |
| `STAND - MOMBO COMBO` | STAND - MOMBO COMBO | GE | $0.00 | $33.00 |
| `9 LIGHT MAXIBRUTE HEAD` | 9 LIGHT MAXIBRUTE HEAD | PRO_SUPPLIES | $0.00 | $200.00 |
| `9 LIGHT FAY HEAD - TYPE 5541` | 9 LIGHT FAY HEAD - TYPE 5541 | PRO_SUPPLIES | $0.00 | $135.00 |
| `MEDIUM QUARTZ PLUS CHIMERA BANK (8435)` | MEDIUM QUARTZ PLUS CHIMERA BANK (8435) | GE | $0.00 | $70.00 |
| `LARGE QUARTZ PLUS CHIMERA BANK (8445)` | LARGE QUARTZ PLUS CHIMERA BANK (8445) | GE | $0.00 | $81.00 |
| `LITEPANEL 1X1 CHIMERA BANK (1655) ASTRA` | LITEPANEL 1X1 CHIMERA BANK (1655) ASTRA | GE | $0.00 | $75.00 |
| `1639 (M) CHIMERA LIGHTBANK - SKYPANEL S60` | 1639 (M) CHIMERA LIGHTBANK - SKYPANEL S60 | GE | $0.00 | $85.00 |
| `ARRI SKYPANEL S60 - SNAPGRID 40 DEGREE` | ARRI SKYPANEL S60 - SNAPGRID 40 DEGREE | PRO_SUPPLIES | $0.00 | $50.00 |
| `10K QUARTZ GLOBE (DTY)` | 10K QUARTZ GLOBE (DTY) | PRO_SUPPLIES | $0.00 | $54.00 |
| `5K QUARTZ GLOBE (DPY)` | 5K QUARTZ GLOBE (DPY) | PRO_SUPPLIES | $0.00 | $22.00 |
| `2K QUARTZ GLOBE (CYX)` | 2K QUARTZ GLOBE (CYX) | PRO_SUPPLIES | $0.00 | $13.00 |
| `2K GLOBE (FEY)` | 2K GLOBE (FEY) | PRO_SUPPLIES | $0.00 | $9.00 |
| `1K QUARTZ GLOBE (EGT)` | 1K QUARTZ GLOBE (EGT) | PRO_SUPPLIES | $0.00 | $9.00 |
| `1K GLOBE (FCM)` | 1K GLOBE (FCM) | PRO_SUPPLIES | $0.00 | $5.00 |
| `1K GLOBE (DXW)` | 1K GLOBE (DXW) | PRO_SUPPLIES | $0.00 | $8.00 |
| `REGULAR 407 1K SCRIM (5-PIECE SET)` | REGULAR 407 1K SCRIM (5-PIECE SET) | PRO_SUPPLIES | $0.00 | $8.00 |
| `MIDGET SCRIM (5-PIECE SET)` | MIDGET SCRIM (5-PIECE SET) | PRO_SUPPLIES | $0.00 | $7.00 |
| `ARRI 300W SCRIM (5 PC SET)` | ARRI 300W SCRIM (5 PC SET) | PRO_SUPPLIES | $0.00 | $7.00 |
| `ARRI SKYPANEL S60 CONTROL GRID 40 DEGREE MED` | ARRI SKYPANEL S60 CONTROL GRID 40 DEGREE MED | PRO_SUPPLIES | $0.00 | $100.00 |
| `ARRI SKYPANEL S60 CONTROL GRID 40 DEGREE SMALL` | ARRI SKYPANEL S60 CONTROL GRID 40 DEGREE SMALL | PRO_SUPPLIES | $0.00 | $100.00 |
| `ARRI SKYPANEL S60 CONTROL GRID 50 DEGREE SMALL` | ARRI SKYPANEL S60 CONTROL GRID 50 DEGREE SMALL | PRO_SUPPLIES | $0.00 | $100.00 |
| `Barricade with Lights` | Barricade with Lights | PRO_SUPPLIES | $0.00 | $15.00 |
| `Worklight - Battery Powered Worklight PELICAN` | Worklight - Battery Powered Worklight PELICAN | EXPENDABLES | $0.00 | $75.00 |
| `LED Flashlight` | LED Flashlight | PRO_SUPPLIES | $0.00 | $15.00 |
| `Sledge Hammer 10 lbs` | Sledge Hammer 10 lbs | PRO_SUPPLIES | $0.00 | $18.00 |
| `ARRI SKYPANEL S60-C MEDIUM/STANDARD DIFFUSION` | ARRI SKYPANEL S60-C MEDIUM/STANDARD DIFFUSION | PRO_SUPPLIES | $0.00 | $7.00 |
| `SUMO- BALLAST` | SUMO- BALLAST | GE | $0.00 | $375.00 |
| `SUMO LIGHTR SKIRT` | SUMO LIGHTR SKIRT | GE | $0.00 | $375.00 |
| `UTAH - WORKLIGHT, DEWALT` | UTAH - WORKLIGHT, DEWALT | PRO_SUPPLIES | $0.00 | $75.00 |
| `HANDWASHING STATION (40% OFF)` | HANDWASHING STATION (40% OFF) | PRO_SUPPLIES | $0.00 | $171.00 |
| `DIRECTOR'S SHIELD` | DIRECTOR'S SHIELD | PRO_SUPPLIES | $0.00 | $30.00 |
| `Inverter - 300 Watt` | Inverter - 300 Watt | PRO_SUPPLIES | $0.00 | $45.00 |
| `18" X 24"  WOOD CUCOLORIS` | 18" X 24"  WOOD CUCOLORIS | PRO_SUPPLIES | $0.00 | $5.00 |
| `First Aid Kit "50 Person"` | First Aid Kit "50 Person" | PRO_SUPPLIES | $0.00 | $75.00 |
| `HAND SANITIZING STATION (40% OFF)` | HAND SANITIZING STATION (40% OFF) | PRO_SUPPLIES | $0.00 | $45.00 |
| `2X4 EAR FITTING` | 2X4 EAR FITTING | PRO_SUPPLIES | $0.00 | $6.00 |
| `3' SPANSET` | 3' SPANSET | PRO_SUPPLIES | $0.00 | $7.00 |
| `4' X 4' CELLO CUCOLORIS` | 4' X 4' CELLO CUCOLORIS | PRO_SUPPLIES | $0.00 | $10.00 |
| `4' X 4' GOLD LEAF` | 4' X 4' GOLD LEAF | PRO_SUPPLIES | $0.00 | $11.00 |
| `4' X 4' SILVER LEAF` | 4' X 4' SILVER LEAF | PRO_SUPPLIES | $0.00 | $10.00 |
| `4' X 4' WOOD CUCOLORIS` | 4' X 4' WOOD CUCOLORIS | PRO_SUPPLIES | $0.00 | $10.00 |
| `4' Truck Shelf` | 4' Truck Shelf | PRO_SUPPLIES | $0.00 | $12.00 |
| `4' X 4' BEADBOARD SILVER / WHITE` | 4' X 4' BEADBOARD SILVER / WHITE | PRO_SUPPLIES | $0.00 | $7.00 |
| `4' X 4' BEADBOARD WHITE / WHITE` | 4' X 4' BEADBOARD WHITE / WHITE | PRO_SUPPLIES | $0.00 | $7.00 |
| `Pail, Plastic 5 Gallon` | Pail, Plastic 5 Gallon | PRO_SUPPLIES | $0.00 | $6.00 |
| `STEEL DECK NUT & BOLT` | STEEL DECK NUT & BOLT | PRO_SUPPLIES | $0.00 | $0.50 |
| `ShotBags - 20lbs` | ShotBags - 20lbs | PRO_SUPPLIES | $0.00 | $9.00 |
| `DOORWAY DOLLY` | DOORWAY DOLLY | PRO_SUPPLIES | $0.00 | $150.00 |
| `4' DOLLY TRACK SECTION (STEEL)` | 4' DOLLY TRACK SECTION (STEEL) | PRO_SUPPLIES | $0.00 | $22.00 |
| `10' DOLLY TRACK SECTION (STEEL)` | 10' DOLLY TRACK SECTION (STEEL) | PRO_SUPPLIES | $0.00 | $33.00 |
| `SPEEDRAIL COUPLER 1 1/4"` | SPEEDRAIL COUPLER 1 1/4" | PRO_SUPPLIES | $0.00 | $6.00 |
| `TRIANGULAR TRUSS MAKER 1-1/4"` | TRIANGULAR TRUSS MAKER 1-1/4" | PRO_SUPPLIES | $0.00 | $11.00 |
| `LADDER TRUSS BRACKET 1 1/4"` | LADDER TRUSS BRACKET 1 1/4" | PRO_SUPPLIES | $0.00 | $8.00 |
| `BOX OF WEDGES` | BOX OF WEDGES | PRO_SUPPLIES | $0.00 | $12.00 |
| `BOX OF 1 X 3 CRIBBING` | BOX OF 1 X 3 CRIBBING | PRO_SUPPLIES | $0.00 | $11.00 |
| `BOX OF 4ﬂ X 4ﬂ CRIBBING` | BOX OF 4ﬂ X 4ﬂ CRIBBING | PRO_SUPPLIES | $0.00 | $11.00 |
| `CUP BLOCKS HOLDER (12 PER SET)` | CUP BLOCKS HOLDER (12 PER SET) | PRO_SUPPLIES | $0.00 | $11.00 |
| `CUP BLOCK (EACH)` | CUP BLOCK (EACH) | PRO_SUPPLIES | $0.00 | $2.00 |
| `6' X 6' EGGCRATE - 40 DEG. LCD` | 6' X 6' EGGCRATE - 40 DEG. LCD | PRO_SUPPLIES | $0.00 | $125.00 |
| `6' Table Linen - Black (Regular)` | 6' Table Linen - Black (Regular) | PRO_SUPPLIES | $0.00 | $15.00 |
| `6' Wardrobe Mirror` | 6' Wardrobe Mirror | PRO_SUPPLIES | $0.00 | $37.50 |
| `SPEED CLIP 1-1/4ﬂ (BLACK)` | SPEED CLIP 1-1/4ﬂ (BLACK) | PRO_SUPPLIES | $0.00 | $4.00 |
| `JR. NAIL-ON PLATE` | JR. NAIL-ON PLATE | PRO_SUPPLIES | $0.00 | $8.00 |
| `NORMS PIN (5/8" PIN TO 3/8" PIN)` | NORMS PIN (5/8" PIN TO 3/8" PIN) | PRO_SUPPLIES | $0.00 | $6.00 |
| `SPEEDRAIL EAR 1 1/4ﬂ` | SPEEDRAIL EAR 1 1/4ﬂ | PRO_SUPPLIES | $0.00 | $7.00 |
| `1" SQUARE EAR` | 1" SQUARE EAR | PRO_SUPPLIES | $0.00 | $7.00 |
| `1"SQUARE CORNER` | 1"SQUARE CORNER | PRO_SUPPLIES | $0.00 | $5.00 |
| `1 1/4" SPEEDRAIL CORNER` | 1 1/4" SPEEDRAIL CORNER | PRO_SUPPLIES | $0.00 | $7.00 |
| `8' X 8' EGGCRATE - 40 DEG. LCD` | 8' X 8' EGGCRATE - 40 DEG. LCD | PRO_SUPPLIES | $0.00 | $125.00 |
| `8' Truck Shelf` | 8' Truck Shelf | PRO_SUPPLIES | $0.00 | $24.00 |
| `ANTON BAUER  BATTERY` | ANTON BAUER  BATTERY | EXPENDABLES | $0.00 | $50.00 |
| `575W HPL GLOBE` | 575W HPL GLOBE | PRO_SUPPLIES | $0.00 | $7.00 |
| `420W GLOBE (EKB)` | 420W GLOBE (EKB) | PRO_SUPPLIES | $0.00 | $8.00 |
| `200W GLOBE (FEV)` | 200W GLOBE (FEV) | PRO_SUPPLIES | $0.00 | $8.00 |
| `300W GLOBE (FKW)` | 300W GLOBE (FKW) | PRO_SUPPLIES | $0.00 | $8.00 |
| `150W GLOBE (ESP)` | 150W GLOBE (ESP) | PRO_SUPPLIES | $0.00 | $6.00 |
| `Bose Sound Link Flex (Bluetooth Speaker` | Bose Sound Link Flex (Bluetooth Speaker | PRO_SUPPLIES | $0.00 | $105.00 |
| `Corn Broom` | Corn Broom | PRO_SUPPLIES | $0.00 | $12.00 |
| `Push Broom` | Push Broom | PRO_SUPPLIES | $0.00 | $12.00 |
| `Bungee Strap` | Bungee Strap | PRO_SUPPLIES | $0.00 | $6.00 |
| `Cal/Fed Osha Board` | Cal/Fed Osha Board | PRO_SUPPLIES | $0.00 | $36.00 |
| `Rubber Maid Cart` | Rubber Maid Cart | PRO_SUPPLIES | $0.00 | $60.00 |
| `Cone - 18"` | Cone - 18" | PRO_SUPPLIES | $0.00 | $6.00 |
| `Cone - 28"` | Cone - 28" | PRO_SUPPLIES | $0.00 | $9.00 |
| `Cone - 36" Delineators` | Cone - 36" Delineators | PRO_SUPPLIES | $0.00 | $15.00 |
| `Cooler - 100 QT (Large)` | Cooler - 100 QT (Large) | PRO_SUPPLIES | $0.00 | $18.00 |
| `Cooler - 48 QT (Small)` | Cooler - 48 QT (Small) | PRO_SUPPLIES | $0.00 | $18.00 |
| `Cooler - Gatorade` | Cooler - Gatorade | PRO_SUPPLIES | $0.00 | $18.00 |
| `Motorola CP200d  UHF Radio (Digital)` | Motorola CP200d  UHF Radio (Digital) | COMMUNICATIONS | $0.00 | $30.00 |
| `Folding Chairs` | Folding Chairs | PRO_SUPPLIES | $0.00 | $6.00 |
| `4' x 8' Crash Pads` | 4' x 8' Crash Pads | PRO_SUPPLIES | $0.00 | $90.00 |
| `Chair Rack, Rolling` | Chair Rack, Rolling | PRO_SUPPLIES | $0.00 | $30.00 |
| `Director's Chair - Low` | Director's Chair - Low | PRO_SUPPLIES | $0.00 | $9.00 |
| `Director's Chair Rack, Hanging` | Director's Chair Rack, Hanging | PRO_SUPPLIES | $0.00 | $9.00 |
| `Director's Chair Cart, Rolling` | Director's Chair Cart, Rolling | PRO_SUPPLIES | $0.00 | $30.00 |
| `Director's Chair - Tall` | Director's Chair - Tall | PRO_SUPPLIES | $0.00 | $12.00 |
| `Dolly - Furniture (4 Wheel)` | Dolly - Furniture (4 Wheel) | PRO_SUPPLIES | $0.00 | $15.00 |
| `D - Rings` | D - Rings | PRO_SUPPLIES | $0.00 | $3.00 |
| `Dust Mop` | Dust Mop | PRO_SUPPLIES | $0.00 | $6.00 |
| `Dust Pan` | Dust Pan | PRO_SUPPLIES | $0.00 | $6.00 |
| `ELECTROSTATIC SPRAYER CASE` | ELECTROSTATIC SPRAYER CASE | PRO_SUPPLIES | $0.00 | $750.00 |
| `Extension Cord - 25'` | Extension Cord - 25' | PRO_SUPPLIES | $0.00 | $12.00 |
| `Extension Cord - 50'` | Extension Cord - 50' | PRO_SUPPLIES | $0.00 | $15.00 |
| `Fan - Box` | Fan - Box | PRO_SUPPLIES | $0.00 | $18.00 |
| `Fan - Metal Utility` | Fan - Metal Utility | PRO_SUPPLIES | $0.00 | $30.00 |
| `Fan - Reel Effects II` | Fan - Reel Effects II | PRO_SUPPLIES | $0.00 | $195.00 |
| `Fire Extinguisher Rack` | Fire Extinguisher Rack | PRO_SUPPLIES | $0.00 | $4.50 |
| `Rosco 1900 Fogger` | Rosco 1900 Fogger | PRO_SUPPLIES | $0.00 | $150.00 |
| `Fold It Cart` | Fold It Cart | PRO_SUPPLIES | $0.00 | $75.00 |
| `5 Gallon Gas Can` | 5 Gallon Gas Can | PRO_SUPPLIES | $0.00 | $15.00 |
| `Wardrobe Hanger 17" Clear, Pant w/ Clip - Each` | Wardrobe Hanger 17" Clear, Pant w/ Clip - Each | PRO_SUPPLIES | $0.00 | $1.50 |
| `Wardrobe Hanger 17" Clear, Shirt/Dress - Each` | Wardrobe Hanger 17" Clear, Shirt/Dress - Each | PRO_SUPPLIES | $0.00 | $1.50 |
| `Hard Hats` | Hard Hats | PRO_SUPPLIES | $0.00 | $7.50 |
| `Heater - Dish (Electrical)` | Heater - Dish (Electrical) | PRO_SUPPLIES | $0.00 | $19.50 |
| `Hand Mics` | Hand Mics | PRO_SUPPLIES | $0.00 | $9.00 |
| `50' Garden Hose` | 50' Garden Hose | PRO_SUPPLIES | $0.00 | $22.50 |
| `PRINTER - HP OFFICE JET PRO 8028e` | PRINTER - HP OFFICE JET PRO 8028e | PRO_SUPPLIES | $0.00 | $150.00 |
| `Headset w/ Boom Mic` | Headset w/ Boom Mic | COMMUNICATIONS | $0.00 | $30.00 |
| `Inverter - 250 Watt` | Inverter - 250 Watt | PRO_SUPPLIES | $0.00 | $30.00 |
| `Iron` | Iron | PRO_SUPPLIES | $0.00 | $21.00 |
| `Ironing Board` | Ironing Board | PRO_SUPPLIES | $0.00 | $30.00 |
| `JHOOK` | JHOOK | PRO_SUPPLIES | $0.00 | $6.00 |
| `Laundry Tub/Cart` | Laundry Tub/Cart | PRO_SUPPLIES | $0.00 | $45.00 |
| `Leaf Blower - Gas` | Leaf Blower - Gas | PRO_SUPPLIES | $0.00 | $75.00 |
| `4' Table Linen - Black (Stretch)` | 4' Table Linen - Black (Stretch) | PRO_SUPPLIES | $0.00 | $12.00 |
| `6' Table Linen - Black (Event)` | 6' Table Linen - Black (Event) | PRO_SUPPLIES | $0.00 | $15.00 |
| `6' Table Linen - White` | 6' Table Linen - White | PRO_SUPPLIES | $0.00 | $15.00 |
| `8' Table Linen - Black (Regular)` | 8' Table Linen - Black (Regular) | PRO_SUPPLIES | $0.00 | $18.00 |
| `Milk Crate` | Milk Crate | PRO_SUPPLIES | $0.00 | $6.00 |
| `MICROPHONE, 3 PIN` | MICROPHONE, 3 PIN | PRO_SUPPLIES | $0.00 | $15.00 |
| `MICROWAVE` | MICROWAVE | PRO_SUPPLIES | $0.00 | $60.00 |
| `Mop, Bucket & Ringer` | Mop, Bucket & Ringer | PRO_SUPPLIES | $0.00 | $24.00 |
| `PULLY FIXED 1/2` | PULLY FIXED 1/2 | PRO_SUPPLIES | $0.00 | $12.00 |
| `PULLY FIXED 3/8` | PULLY FIXED 3/8 | PRO_SUPPLIES | $0.00 | $12.00 |
| `Ratchet Straps` | Ratchet Straps | PRO_SUPPLIES | $0.00 | $6.00 |
| `4' x 8' x 3/4" Plywood Rental` | 4' x 8' x 3/4" Plywood Rental | PRO_SUPPLIES | $0.00 | $30.00 |
| `Power Strip` | Power Strip | PRO_SUPPLIES | $0.00 | $9.00 |
| `Pallet Jack` | Pallet Jack | PRO_SUPPLIES | $0.00 | $60.00 |
| `Hudson Sprayer "Pump"` | Hudson Sprayer "Pump" | PRO_SUPPLIES | $0.00 | $30.00 |
| `PULLY SWIVEL 1/2` | PULLY SWIVEL 1/2 | PRO_SUPPLIES | $0.00 | $12.00 |
| `PULLY SWIVEL 3/8` | PULLY SWIVEL 3/8 | PRO_SUPPLIES | $0.00 | $12.00 |
| `Leaf Rake` | Leaf Rake | PRO_SUPPLIES | $0.00 | $9.00 |
| `Rock Rake` | Rock Rake | PRO_SUPPLIES | $0.00 | $9.00 |
| `Rubber Mat 3' x 10'` | Rubber Mat 3' x 10' | PRO_SUPPLIES | $0.00 | $30.00 |
| `Rubber Mat 3' x 5'` | Rubber Mat 3' x 5' | PRO_SUPPLIES | $0.00 | $15.00 |
| `Road Sign - Men Working` | Road Sign - Men Working | PRO_SUPPLIES | $0.00 | $30.00 |
| `Road Sign - Prepare to Stop` | Road Sign - Prepare to Stop | PRO_SUPPLIES | $0.00 | $30.00 |
| `Road Sign - Road Work Ahead` | Road Sign - Road Work Ahead | PRO_SUPPLIES | $0.00 | $30.00 |
| `CAMLOK SOFT 3-FER - (M/FFF)` | CAMLOK SOFT 3-FER - (M/FFF) | GE | $0.00 | $13.00 |
| `CAMLOK SOFT 3-FER GROUND` | CAMLOK SOFT 3-FER GROUND | GE | $0.00 | $13.00 |
| `SUMO- POWER FEEDER` | SUMO- POWER FEEDER | GE | $0.00 | $375.00 |
| `SUMO- CHAIN LINK` | SUMO- CHAIN LINK | GE | $0.00 | $375.00 |
| `STEEL DECK LEGS 18inch` | STEEL DECK LEGS 18inch | PRO_SUPPLIES | $0.00 | $3.00 |
| `STEEL DECK LEGS 2ft` | STEEL DECK LEGS 2ft | PRO_SUPPLIES | $0.00 | $3.00 |
| `STEEL DECK LEGS 4ft` | STEEL DECK LEGS 4ft | PRO_SUPPLIES | $0.00 | $3.00 |
| `STEEL DECK LEGS 1ft` | STEEL DECK LEGS 1ft | PRO_SUPPLIES | $0.00 | $3.00 |
| `Wet/Dry Shop Vacuum` | Wet/Dry Shop Vacuum | PRO_SUPPLIES | $0.00 | $60.00 |
| `Shovel - Flat` | Shovel - Flat | PRO_SUPPLIES | $0.00 | $9.00 |
| `Shovel - Snow` | Shovel - Snow | PRO_SUPPLIES | $0.00 | $15.00 |
| `Shovel - Spade` | Shovel - Spade | PRO_SUPPLIES | $0.00 | $9.00 |
| `8' Folding Table` | 8' Folding Table | PRO_SUPPLIES | $0.00 | $21.00 |
| `SUMO LENS 30 DEGREE` | SUMO LENS 30 DEGREE | GE | $0.00 | $375.00 |
| `Super Shelf, Rolling, 9' 10" L x 5' H` | Super Shelf, Rolling, 9' 10" L x 5' H | PRO_SUPPLIES | $0.00 | $60.00 |
| `STEEL DECK LEGS 9inch` | STEEL DECK LEGS 9inch | PRO_SUPPLIES | $0.00 | $3.00 |
| `Stop/Slow Sign - Handheld` | Stop/Slow Sign - Handheld | PRO_SUPPLIES | $0.00 | $6.00 |
| `4' Table (Fold in Half)` | 4' Table (Fold in Half) | PRO_SUPPLIES | $0.00 | $15.00 |
| `6' Table (Fold In Half)` | 6' Table (Fold In Half) | PRO_SUPPLIES | $0.00 | $18.00 |
| `MEDIUM TARP` | MEDIUM TARP | PRO_SUPPLIES | $0.00 | $15.00 |
| `Tea Kettle (1.7 liter) - Electric` | Tea Kettle (1.7 liter) - Electric | GE | $0.00 | $30.00 |
| `Caravan Canopy - 10' x 10' Tent, Black` | Caravan Canopy - 10' x 10' Tent, Black | PRO_SUPPLIES | $0.00 | $90.00 |
| `Caravan Canopy - 10' x 10' Tent, Blue` | Caravan Canopy - 10' x 10' Tent, Blue | PRO_SUPPLIES | $0.00 | $90.00 |
| `Caravan Canopy - 10' x 10' Tent, White` | Caravan Canopy - 10' x 10' Tent, White | PRO_SUPPLIES | $0.00 | $150.00 |
| `Caravan Canopy - 10' x 15' Tent, Blue` | Caravan Canopy - 10' x 15' Tent, Blue | PRO_SUPPLIES | $0.00 | $120.00 |
| `Caravan Canopy - 10' x 15' Tent, Grey` | Caravan Canopy - 10' x 15' Tent, Grey | PRO_SUPPLIES | $0.00 | $120.00 |
| `Caravan Canopy - 10' x 15' Tent, White` | Caravan Canopy - 10' x 15' Tent, White | PRO_SUPPLIES | $0.00 | $120.00 |
| `Caravan Canopy - 10' x 20' Tent, Black` | Caravan Canopy - 10' x 20' Tent, Black | PRO_SUPPLIES | $0.00 | $165.00 |
| `Caravan Canopy - 10' x 20' Tent, Blue` | Caravan Canopy - 10' x 20' Tent, Blue | PRO_SUPPLIES | $0.00 | $165.00 |
| `Caravan Canopy - 8' x '8 Tent, Black` | Caravan Canopy - 8' x '8 Tent, Black | PRO_SUPPLIES | $0.00 | $75.00 |
| `Canopy Tent Sidewall - 8' Black` | Canopy Tent Sidewall - 8' Black | PRO_SUPPLIES | $0.00 | $18.00 |
| `Canopy Tent Sidewall - 10' Blue` | Canopy Tent Sidewall - 10' Blue | PRO_SUPPLIES | $0.00 | $18.00 |
| `Canopy Tent Sidewall - 10' Black` | Canopy Tent Sidewall - 10' Black | PRO_SUPPLIES | $0.00 | $18.00 |
| `Canopy Tent Sidewall - 10' White` | Canopy Tent Sidewall - 10' White | PRO_SUPPLIES | $0.00 | $30.00 |
| `Canopy Tent Sidewall - 15' Blue` | Canopy Tent Sidewall - 15' Blue | PRO_SUPPLIES | $0.00 | $18.00 |
| `Canopy Tent Sidewall - 15' black` | Canopy Tent Sidewall - 15' black | PRO_SUPPLIES | $0.00 | $18.00 |
| `Utility Tool Rack` | Utility Tool Rack | PRO_SUPPLIES | $0.00 | $9.00 |
| `Surveillance Kit` | Surveillance Kit | COMMUNICATIONS | $0.00 | $21.00 |
| `100A BATES CABLE EXTENSION 25'` | 100A BATES CABLE EXTENSION 25' | GE | $0.00 | $17.00 |
| `Trash Grabber` | Trash Grabber | PRO_SUPPLIES | $0.00 | $6.00 |
| `Office Trash Can` | Office Trash Can | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - BUNGEE STRAP` | UTAH - BUNGEE STRAP | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - BUTT CANS` | UTAH - BUTT CANS | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - 4' FOLDING TABLE` | UTAH - 4' FOLDING TABLE | PRO_SUPPLIES | $0.00 | $15.00 |
| `UTAH - CONE, 28"` | UTAH - CONE, 28" | PRO_SUPPLIES | $0.00 | $9.00 |
| `UTAH - FOLDING CHAIRS` | UTAH - FOLDING CHAIRS | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - CHAIR RACK, ROLLING` | UTAH - CHAIR RACK, ROLLING | PRO_SUPPLIES | $0.00 | $30.00 |
| `UTAH - DIRECTOR'S CHAIR, LOW` | UTAH - DIRECTOR'S CHAIR, LOW | PRO_SUPPLIES | $0.00 | $9.00 |
| `UTAH - DIRECTOR'S CHAIR CART` | UTAH - DIRECTOR'S CHAIR CART | PRO_SUPPLIES | $0.00 | $30.00 |
| `UTAH - DIRECTOR'S CHAIR, TALL` | UTAH - DIRECTOR'S CHAIR, TALL | PRO_SUPPLIES | $0.00 | $12.00 |
| `UTAH - D - RINGS` | UTAH - D - RINGS | PRO_SUPPLIES | $0.00 | $3.00 |
| `UTAH - EXTENSION CORD, 100'` | UTAH - EXTENSION CORD, 100' | PRO_SUPPLIES | $0.00 | $18.00 |
| `UTAH - EXTENSION CORD, 50'` | UTAH - EXTENSION CORD, 50' | PRO_SUPPLIES | $0.00 | $15.00 |
| `UTAH - BOX FAN` | UTAH - BOX FAN | PRO_SUPPLIES | $0.00 | $18.00 |
| `UTAH - TABLE TOP MAKE UP MIRROR` | UTAH - TABLE TOP MAKE UP MIRROR | PRO_SUPPLIES | $0.00 | $60.00 |
| `UTAH - IRON` | UTAH - IRON | PRO_SUPPLIES | $0.00 | $21.00 |
| `UTAH - 6' TABLE LINEN, BLACK` | UTAH - 6' TABLE LINEN, BLACK | PRO_SUPPLIES | $0.00 | $15.00 |
| `UTAH - LOCO MAT - 3' x 5'` | UTAH - LOCO MAT - 3' x 5' | PRO_SUPPLIES | $0.00 | $15.00 |
| `Umbrella - Golf` | Umbrella - Golf | PRO_SUPPLIES | $0.00 | $10.50 |
| `UTAH - MILK CRATE` | UTAH - MILK CRATE | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - WET/DRY SHOP VAC` | UTAH - WET/DRY SHOP VAC | PRO_SUPPLIES | $0.00 | $60.00 |
| `UTAH - WARDROBE STEAMER` | UTAH - WARDROBE STEAMER | PRO_SUPPLIES | $0.00 | $36.00 |
| `UTAH - 6' FOLDING TABLE` | UTAH - 6' FOLDING TABLE | PRO_SUPPLIES | $0.00 | $18.00 |
| `UTAH - FURNITURE PADS` | UTAH - FURNITURE PADS | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - CARAVAN CANOPY - 10' x 10' TENT,BLACK` | UTAH - CARAVAN CANOPY - 10' x 10' TENT,BLACK | PRO_SUPPLIES | $0.00 | $90.00 |
| `UTAH - TRASH CAN (33 GAL)` | UTAH - TRASH CAN (33 GAL) | PRO_SUPPLIES | $0.00 | $9.00 |
| `UTAH - ROLLING WARDROBE RACK` | UTAH - ROLLING WARDROBE RACK | PRO_SUPPLIES | $0.00 | $30.00 |
| `Water - Dispenser` | Water - Dispenser | PRO_SUPPLIES | $0.00 | $36.00 |
| `10' DMX 5-PIN CABLE` | 10' DMX 5-PIN CABLE | GE | $0.00 | $8.00 |
| `3 WIRE 100ft banded` | 3 WIRE 100ft banded | PRO_SUPPLIES | $0.00 | $29.00 |
| `100A BATES CABLE EXTENSION 100'` | 100A BATES CABLE EXTENSION 100' | GE | $0.00 | $26.00 |
| `50' EDISON CABLE (STINGER)` | 50' EDISON CABLE (STINGER) | GE | $0.00 | $9.00 |
| `GRID CLAMP W/JR. RECEIVER - HORIZONTAL` | GRID CLAMP W/JR. RECEIVER - HORIZONTAL | PRO_SUPPLIES | $0.00 | $9.00 |
| `8"C-CLAMP W/PIN` | 8"C-CLAMP W/PIN | PRO_SUPPLIES | $0.00 | $8.00 |
| `8ﬂ C-CLAMP W/JR. RECEIVER` | 8ﬂ C-CLAMP W/JR. RECEIVER | PRO_SUPPLIES | $0.00 | $8.00 |
| `Clamp Light` | Clamp Light | PRO_SUPPLIES | $0.00 | $6.00 |
| `12' X 12' DOUBLE NET RAG` | 12' X 12' DOUBLE NET RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `12' X 12' ULTRABOUNCE RAG` | 12' X 12' ULTRABOUNCE RAG | PRO_SUPPLIES | $0.00 | $75.00 |
| `18" X 24" DOUBLE NET FLAG` | 18" X 24" DOUBLE NET FLAG | GE | $0.00 | $5.00 |
| `20' X 20' DOUBLE NET RAG` | 20' X 20' DOUBLE NET RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `20' X 20' ULTRABOUNCE RAG` | 20' X 20' ULTRABOUNCE RAG | PRO_SUPPLIES | $0.00 | $125.00 |
| `24" X 36" SOLID FLAG` | 24" X 36" SOLID FLAG | GE | $0.00 | $5.50 |
| `24" X 36" SILK FLAG` | 24" X 36" SILK FLAG | GE | $0.00 | $5.50 |
| `2' X 4' DOUBLE MEAT AX FLAG` | 2' X 4' DOUBLE MEAT AX FLAG | GE | $0.00 | $11.00 |
| `4' X 4' SILVER LAME RAG` | 4' X 4' SILVER LAME RAG | PRO_SUPPLIES | $0.00 | $15.00 |
| `48" X 48" ULTRABOUNCE` | 48" X 48" ULTRABOUNCE | PRO_SUPPLIES | $0.00 | $10.00 |
| `5' SPEEDRAIL PIPE 1-1/4"` | 5' SPEEDRAIL PIPE 1-1/4" | PRO_SUPPLIES | $0.00 | $6.00 |
| `6' X 6' BLACK/WHITE GRIFF. RAG` | 6' X 6' BLACK/WHITE GRIFF. RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' GOLD LAME RAG` | 6' X 6' GOLD LAME RAG | PRO_SUPPLIES | $0.00 | $40.00 |
| `6' X 6' LITE (1/2) GRID RAG` | 6' X 6' LITE (1/2) GRID RAG | PRO_SUPPLIES | $0.00 | $35.00 |
| `6' X 6' POLY SILK RAG` | 6' X 6' POLY SILK RAG | GE | $0.00 | $35.00 |
| `6' X 6' SILVER LAME RAG` | 6' X 6' SILVER LAME RAG | PRO_SUPPLIES | $0.00 | $40.00 |
| `12ﬂ FURNITURE CLAMP` | 12ﬂ FURNITURE CLAMP | PRO_SUPPLIES | $0.00 | $7.00 |
| `CHAIN VISE GRIP W/PIN` | CHAIN VISE GRIP W/PIN | GE | $0.00 | $8.00 |
| `8' X 12' SOLID BLACK RAG` | 8' X 12' SOLID BLACK RAG | PRO_SUPPLIES | $0.00 | $54.00 |
| `8' X 8' GRIFFLON RAG` | 8' X 8' GRIFFLON RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `8' X 8' SINGLE NET RAG` | 8' X 8' SINGLE NET RAG | PRO_SUPPLIES | $0.00 | $45.00 |
| `BABY GRID CLAMPS WITH ERARS` | BABY GRID CLAMPS WITH ERARS | PRO_SUPPLIES | $0.00 | $3.00 |
| `Bolt Cutter` | Bolt Cutter | PRO_SUPPLIES | $0.00 | $30.00 |
| `FLEX ARM EXTENTION` | FLEX ARM EXTENTION | PRO_SUPPLIES | $0.00 | $8.00 |
| `2 1/2 GOBO HEAD` | 2 1/2 GOBO HEAD | PRO_SUPPLIES | $0.00 | $8.00 |
| `35 LB. SANDBAG` | 35 LB. SANDBAG | GE | $0.00 | $12.00 |
| `2' X 4' WALL SPREADER` | 2' X 4' WALL SPREADER | PRO_SUPPLIES | $0.00 | $8.00 |
| `Leaf Blower - Electric (Plug In)` | Leaf Blower - Electric (Plug In) | GE | $0.00 | $45.00 |
| `ARRI SKYPANEL REMOTE` | ARRI SKYPANEL REMOTE | PRO_SUPPLIES | $0.00 | $50.00 |
| `200 MIDGET BARN DOOR` | 200 MIDGET BARN DOOR | PRO_SUPPLIES | $0.00 | $6.00 |
| `BABY BABY 1K SCRIM (5-PIECE SET)` | BABY BABY 1K SCRIM (5-PIECE SET) | PRO_SUPPLIES | $0.00 | $8.00 |
| `MINI REFRIGERATOR` | MINI REFRIGERATOR | PRO_SUPPLIES | $0.00 | $90.00 |
| `SMALL QUARTZ PLUS CHIMERA BANK (8425)` | SMALL QUARTZ PLUS CHIMERA BANK (8425) | GE | $0.00 | $59.00 |
| `650W GLOBE (FRK)` | 650W GLOBE (FRK) | PRO_SUPPLIES | $0.00 | $8.00 |
| `Worklight - Battery Powered Worklight (Dewalt)` | Worklight - Battery Powered Worklight (Dewalt) | EXPENDABLES | $0.00 | $75.00 |
| `Worklight - 500 Watt Halogen Double Headed` | Worklight - 500 Watt Halogen Double Headed | PRO_SUPPLIES | $0.00 | $45.00 |
| `18" X 24"  CELLO CUCOLORIS` | 18" X 24"  CELLO CUCOLORIS | PRO_SUPPLIES | $0.00 | $5.00 |
| `24" X 36"  WOOD CUCOLORIS` | 24" X 36"  WOOD CUCOLORIS | PRO_SUPPLIES | $0.00 | $5.50 |
| `Dolly - 2 Wheel Handtruck` | Dolly - 2 Wheel Handtruck | PRO_SUPPLIES | $0.00 | $15.00 |
| `4' X 4' BEADBOARD GOLD / WHITE` | 4' X 4' BEADBOARD GOLD / WHITE | PRO_SUPPLIES | $0.00 | $7.00 |
| `8' DOLLY TRACK SECTION (STEEL)` | 8' DOLLY TRACK SECTION (STEEL) | PRO_SUPPLIES | $0.00 | $27.00 |
| `BOX OF 2 X 4 CRIBBING` | BOX OF 2 X 4 CRIBBING | PRO_SUPPLIES | $0.00 | $11.00 |
| `BASSO BLOCK SET - HALF (12 PER SET)` | BASSO BLOCK SET - HALF (12 PER SET) | PRO_SUPPLIES | $0.00 | $27.00 |
| `BABY NAIL-ON PLATE 2"` | BABY NAIL-ON PLATE 2" | PRO_SUPPLIES | $0.00 | $7.00 |
| `1" SQUARE COUPLER` | 1" SQUARE COUPLER | PRO_SUPPLIES | $0.00 | $6.00 |
| `750W HPL GLOBE` | 750W HPL GLOBE | PRO_SUPPLIES | $0.00 | $7.00 |
| `25' Cooling Hose w/bag` | 25' Cooling Hose w/bag | PRO_SUPPLIES | $0.00 | $30.00 |
| `Butt Cans` | Butt Cans | PRO_SUPPLIES | $0.00 | $6.00 |
| `Portable Pop Up Changing Tent` | Portable Pop Up Changing Tent | PRO_SUPPLIES | $0.00 | $36.00 |
| `Cooler - 68 QT (Medium)` | Cooler - 68 QT (Medium) | PRO_SUPPLIES | $0.00 | $18.00 |
| `Hollywood Director's Chair, Tall` | Hollywood Director's Chair, Tall | PRO_SUPPLIES | $0.00 | $45.00 |
| `DF50 Hazer Fuid` | DF50 Hazer Fuid | PRO_SUPPLIES | $0.00 | $330.00 |
| `Extension Cord - 100'` | Extension Cord - 100' | PRO_SUPPLIES | $0.00 | $18.00 |
| `Speaker - Gemini 115BT (Bluetooth)` | Speaker - Gemini 115BT (Bluetooth) | PRO_SUPPLIES | $0.00 | $240.00 |
| `JR TO BABY ADAPTOR` | JR TO BABY ADAPTOR | PRO_SUPPLIES | $0.00 | $6.00 |
| `Leaf Blower - Battery Powered` | Leaf Blower - Battery Powered | EXPENDABLES | $0.00 | $75.00 |
| `6' Table Linen - Black (Stretch)` | 6' Table Linen - Black (Stretch) | PRO_SUPPLIES | $0.00 | $15.00 |
| `Loco Mat - 3' x 5'` | Loco Mat - 3' x 5' | PRO_SUPPLIES | $0.00 | $15.00 |
| `Pruning Shears` | Pruning Shears | PRO_SUPPLIES | $0.00 | $6.00 |
| `4' x 8' x 1" Plywood Rental` | 4' x 8' x 1" Plywood Rental | PRO_SUPPLIES | $0.00 | $30.00 |
| `STEEL DECK LEGS 3ft` | STEEL DECK LEGS 3ft | PRO_SUPPLIES | $0.00 | $3.00 |
| `SUMO HEAD FEEDER` | SUMO HEAD FEEDER | GE | $0.00 | $375.00 |
| `UTAH - SURVEILLANCE MIC` | UTAH - SURVEILLANCE MIC | COMMUNICATIONS | $0.00 | $21.00 |
| `Table Divider - 29.5" W x 23.5" H` | Table Divider - 29.5" W x 23.5" H | PRO_SUPPLIES | $0.00 | $21.00 |
| `Caravan Canopy - 10' x 15' Tent, Black` | Caravan Canopy - 10' x 15' Tent, Black | PRO_SUPPLIES | $0.00 | $120.00 |
| `Caravan Canopy - 8' x '8 Tent, White` | Caravan Canopy - 8' x '8 Tent, White | PRO_SUPPLIES | $0.00 | $75.00 |
| `Canopy Tent Sidewall - 8' White` | Canopy Tent Sidewall - 8' White | PRO_SUPPLIES | $0.00 | $18.00 |
| `Trash Can (33 gal)` | Trash Can (33 gal) | PRO_SUPPLIES | $0.00 | $9.00 |
| `UTAH - 6' WARDROBE MIRROR` | UTAH - 6' WARDROBE MIRROR | PRO_SUPPLIES | $0.00 | $37.50 |
| `UTAH - EXTENSION CORD, 25'` | UTAH - EXTENSION CORD, 25' | PRO_SUPPLIES | $0.00 | $12.00 |
| `UTAH - IRONING BOARD` | UTAH - IRONING BOARD | PRO_SUPPLIES | $0.00 | $30.00 |
| `UTAH - POWER STRIP` | UTAH - POWER STRIP | PRO_SUPPLIES | $0.00 | $9.00 |
| `UTAH - 6' TABLE (FOLD IN HALF)` | UTAH - 6' TABLE (FOLD IN HALF) | PRO_SUPPLIES | $0.00 | $18.00 |
| `Rolling Wardrobe Rack` | Rolling Wardrobe Rack | PRO_SUPPLIES | $0.00 | $30.00 |
| `UTAH - MOTOROLA CP200 UHF (ANALOG)` | UTAH - MOTOROLA CP200 UHF (ANALOG) | COMMUNICATIONS | $0.00 | $30.00 |
| `UTAH - MOTOROLA CP200 UHF (DIGITAL)` | UTAH - MOTOROLA CP200 UHF (DIGITAL) | COMMUNICATIONS | $0.00 | $30.00 |
| `Personal Folding Table` | Personal Folding Table | PRO_SUPPLIES | $0.00 | $12.00 |
| `6' Folding Table` | 6' Folding Table | PRO_SUPPLIES | $0.00 | $18.00 |
| `4' Folding Table` | 4' Folding Table | PRO_SUPPLIES | $0.00 | $15.00 |
| `25 LB. SANDBAG` | 25 LB. SANDBAG | GE | $0.00 | $9.00 |
| `Furniture Pads` | Furniture Pads | PRO_SUPPLIES | $0.00 | $6.00 |
| `Safety Vest` | Safety Vest | PRO_SUPPLIES | $0.00 | $6.00 |
| `UTAH - RATCHET STRAPS` | UTAH - RATCHET STRAPS | PRO_SUPPLIES | $0.00 | $6.00 |
| `APPLE BOX - FULL` | APPLE BOX - FULL | GE | $0.00 | $6.00 |
| `CARDELLINI CLAMP CENTER JAW` | CARDELLINI CLAMP CENTER JAW | GE | $0.00 | $13.00 |
| `UTAH - HONDA 2000 WATT GENERATOR` | UTAH - HONDA 2000 WATT GENERATOR | GE | $0.00 | $180.00 |

## E. Rate conflicts (informational only — rates are preserved)

Total: **68**.

| Item | SirReel daily | RW daily | Δ | SirReel weekly | RW weekly | Δ |
|---|---:|---:|---:|---:|---:|---:|
| 6K SPACE LIGHT (SOCAPEX) HEAD | $0.00 | $0.00 | $0.00 | $161.00 | $0.00 | -$161.00 |
| Honda 6500 Watt Generator | $0.00 | $200.00 | $200.00 | $600.00 | $600.00 | $0.00 |
| Honda 2000 Watt Generator | $0.00 | $60.00 | $60.00 | $180.00 | $180.00 | $0.00 |
| STAND - 3-RISER BEEFY BABY,STEEL | $0.00 | $10.00 | $10.00 | $10.00 | $0.00 | -$10.00 |
| STAND -3-RISER COMBO (Electric) | $0.00 | $22.00 | $22.00 | $22.00 | $0.00 | -$22.00 |
| STAND - 3 RISER HI HI ROLLER | $0.00 | $25.00 | $25.00 | $20.00 | $0.00 | -$20.00 |
| STAND - 3 RISER HI ROLLER | $0.00 | $23.00 | $23.00 | $23.00 | $0.00 | -$23.00 |
| STAND - LOW COMBO W/4 1/2" GRIP HEAD | $0.00 | $17.00 | $17.00 | $17.00 | $0.00 | -$17.00 |
| RUNAWAY STAND "TURTLE" | $0.00 | $20.00 | $20.00 | $20.00 | $0.00 | -$20.00 |
| 40" C-STAND | $0.00 | $14.00 | $14.00 | $11.00 | $0.00 | -$11.00 |
| 125/200W LTM PAR HEAD | $0.00 | $0.00 | $0.00 | $188.00 | $0.00 | -$188.00 |
| 650W TWEENIE II HEAD - TYPE 4821 | $0.00 | $45.00 | $45.00 | $40.00 | $0.00 | -$40.00 |
| ARRI 300W HEAD | $0.00 | $0.00 | $0.00 | $33.00 | $0.00 | -$33.00 |
| ARRI 150W HEAD | $0.00 | $0.00 | $0.00 | $27.00 | $0.00 | -$27.00 |
| 750W ARRI LITE PLUS OPEN FACE | $0.00 | $0.00 | $0.00 | $43.00 | $0.00 | -$43.00 |
| MOLEPAR 1K HEAD - TYPE 2271 | $0.00 | $0.00 | $0.00 | $43.00 | $0.00 | -$43.00 |
| ETC 750W SOURCE 4 LEKO HEAD | $0.00 | $50.00 | $50.00 | $43.00 | $0.00 | -$43.00 |
| ASTRA 1X1 BI-COLOR - LITEPANEL | $0.00 | $0.00 | $0.00 | $250.00 | $0.00 | -$250.00 |
| KINO CELEB 200 | $0.00 | $0.00 | $0.00 | $175.00 | $0.00 | -$175.00 |
| 1K VARIAC (AC) DIMMER | $0.00 | $0.00 | $0.00 | $25.00 | $0.00 | -$25.00 |
| 2K VARIAC (AC) DIMMER | $0.00 | $0.00 | $0.00 | $30.00 | $0.00 | -$30.00 |
| ARRI SKYPANEL S60- LED | $0.00 | $350.00 | $350.00 | $300.00 | $0.00 | -$300.00 |
| SUMO HEAD BI COLOR LED | $0.00 | $0.00 | $0.00 | $375.00 | $0.00 | -$375.00 |
| MINI MOLE HEAD - TYPE 2801 - INKIE | $0.00 | $0.00 | $0.00 | $33.00 | $0.00 | -$33.00 |
| MIDGET MOLE 200W HEAD - TYPE 2351 | $0.00 | $0.00 | $0.00 | $33.00 | $0.00 | -$33.00 |
| 300W BETWEENIE HEAD - TYPE 3131 | $0.00 | $0.00 | $0.00 | $33.00 | $0.00 | -$33.00 |
| Air Conditioner - 1.5 Ton | $0.00 | $150.00 | $150.00 | $450.00 | $450.00 | $0.00 |
| 2' X 6' STEEL DECK | $0.00 | $0.00 | $0.00 | $55.00 | $0.00 | -$55.00 |
| 2' X 4' STEEL DECK | $0.00 | $0.00 | $0.00 | $50.00 | $0.00 | -$50.00 |
| 2' X 8' STEEL DECK | $0.00 | $50.00 | $50.00 | $50.00 | $0.00 | -$50.00 |
| DANA DOLLY | $0.00 | $150.00 | $150.00 | $150.00 | $150.00 | $0.00 |
| Air Scrubber (750 CFM) | $0.00 | $100.00 | $100.00 | $300.00 | $300.00 | $0.00 |
| Air Scrubber (550 CFM) | $0.00 | $0.00 | $0.00 | $225.00 | $0.00 | -$225.00 |
| STIRRUP HANGER 3' TO 6' | $0.00 | $0.00 | $0.00 | $17.00 | $0.00 | -$17.00 |
| STIRRUP HANGER 5' TO 10' | $0.00 | $0.00 | $0.00 | $22.00 | $0.00 | -$22.00 |
| Bullhorn | $0.00 | $10.00 | $10.00 | $30.00 | $30.00 | $0.00 |
| Coffee Maker - 100 Cup | $0.00 | $15.00 | $15.00 | $45.00 | $45.00 | $0.00 |
| DF50 Hazer (Oil Based) | $0.00 | $110.00 | $110.00 | $330.00 | $330.00 | $0.00 |
| Speaker - QSC K12 | $0.00 | $80.00 | $80.00 | $240.00 | $240.00 | $0.00 |
| Ladder - 10' | $0.00 | $14.00 | $14.00 | $42.00 | $42.00 | $0.00 |
| Ladder - 12' | $0.00 | $16.00 | $16.00 | $48.00 | $48.00 | $0.00 |
| Ladder - 14' | $0.00 | $18.00 | $18.00 | $54.00 | $54.00 | $0.00 |
| Ladder - 6' | $0.00 | $8.00 | $8.00 | $24.00 | $24.00 | $0.00 |
| Ladder - 8' | $0.00 | $10.00 | $10.00 | $30.00 | $30.00 | $0.00 |
| LITEMAT 2 SERIES 2 COMPLETE | $0.00 | $0.00 | $0.00 | $165.00 | $0.00 | -$165.00 |
| LITEMAT 4 PLUS HYBRID COMPLETE | $0.00 | $0.00 | $0.00 | $375.00 | $0.00 | -$375.00 |
| LITEMAT 4  SERIES 2 COMPLETE | $0.00 | $0.00 | $0.00 | $200.00 | $0.00 | -$200.00 |
| Dolly - Magliner Jr. | $0.00 | $10.00 | $10.00 | $30.00 | $30.00 | $0.00 |
| Dolly - Magliner Sr. | $0.00 | $15.00 | $15.00 | $45.00 | $45.00 | $0.00 |
| 10 Gallon Mister | $0.00 | $55.00 | $55.00 | $165.00 | $165.00 | $0.00 |
| Heater - Mobile Propane | $0.00 | $35.00 | $35.00 | $390.00 | $105.00 | -$285.00 |
| Rosco Vapour Fogger | $0.00 | $50.00 | $50.00 | $150.00 | $150.00 | $0.00 |
| Wardrobe Steamer | $0.00 | $12.00 | $12.00 | $36.00 | $36.00 | $0.00 |
| UTAH - SPEAKER,GEMINI 115BT (Bluetooth) | $0.00 | $80.00 | $80.00 | $240.00 | $240.00 | $0.00 |
| Rosco V-Hazer (Water based) | $0.00 | $60.00 | $60.00 | $180.00 | $180.00 | $0.00 |
| STAND - 3-RISER COMBO W/ 4 1/2" GRIP HEAD | $0.00 | $22.00 | $22.00 | $22.00 | $0.00 | -$22.00 |
| 1K MICKEY MOLE HEAD - TYPE 4081 | $0.00 | $0.00 | $0.00 | $43.00 | $0.00 | -$43.00 |
| Dolly - Magliner Sr. with Shelf | $0.00 | $20.00 | $20.00 | $60.00 | $60.00 | $0.00 |
| Honda 3000 Watt Generator | $0.00 | $80.00 | $80.00 | $240.00 | $240.00 | $0.00 |
| 4' X 8' STEEL DECK | $0.00 | $50.00 | $50.00 | $50.00 | $0.00 | -$50.00 |
| STIRRUP HANGER 4' TO 8' | $0.00 | $0.00 | $0.00 | $19.00 | $0.00 | -$19.00 |
| DF50 Hazer (Water Based) | $0.00 | $110.00 | $110.00 | $330.00 | $330.00 | $0.00 |
| Fan - Stage 32" | $0.00 | $25.00 | $25.00 | $75.00 | $75.00 | $0.00 |
| Make Up Mirror, Half (Table Top) | $0.00 | $20.00 | $20.00 | $60.00 | $60.00 | $0.00 |
| Ladder - 4' | $0.00 | $6.00 | $6.00 | $18.00 | $18.00 | $0.00 |
| Make Up Mirror, Rolling | $0.00 | $20.00 | $20.00 | $60.00 | $60.00 | $0.00 |
| Motorola CP200  UHF Radio (Analog) | $0.00 | $10.00 | $10.00 | $30.00 | $30.00 | $0.00 |
| LOW C-STAND - 20" | $0.00 | $11.00 | $11.00 | $11.00 | $0.00 | -$11.00 |

## F. Description / spec enrichment coverage

Of 68 matched items, **54** would receive at least one new field on apply.

- Description enriched: **53**
- Manufacturer set: **1**
- Model set: **1**
- Dimensions set: **0**
- Specs (RW notes) set: **0**
