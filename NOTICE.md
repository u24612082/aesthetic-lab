# Aesthetic Lab / OpenGym integration

This distribution uses the actual frontend from https://github.com/alexpcosta/opengym,
based on DuarteSantos8/openGym, pinned initially at commit
678bf5bf10446e8997a77d43e89c9b2721d8d0fc. OpenGym is Copyright (C) 2026 Duarte Santos
and contributors, licensed AGPL-3.0-or-later. Retained upstream notices are in
`opengym/NOTICE.md` and `opengym/LICENSE`.

Changes in this workspace include the personal-workspace pairing flow, a SQLite-backed
state adapter, the supplied five-day routine, nutrition/coaching integration, pending
save visibility and optimistic concurrency, technique-gated automatic load holds,
full-session exercise rendering, a local MCP bridge, and personal background automation
through the user’s installed Claude Code client and existing subscription sign-in.
The upstream multi-profile/passkey service and Node JSON backend are not used by this
local adaptation. Native mobile build tooling was removed from the web build inputs.

The original Aesthetic Lab backend was MIT licensed; that original notice is preserved
in `LICENSE.original-MIT`. This combined modified application is distributed under the
AGPL-3.0-or-later license in `LICENSE`. Complete corresponding source is offered through
the authenticated app's Source link and the local source archive. No service credentials,
personal SQLite files, iCloud records, or dependency caches are included in that archive.

The exercise dataset and body-map geometry retain their separate upstream terms and
attributions, as detailed in `opengym/NOTICE.md`. Exercise movement photos are bundled from yuhonas/free-exercise-db at revision
f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5 under its Unlicense/public-domain terms.
See aesthetic_lab/exercise_media/LICENSE.free-exercise-db.txt and each image source
link. Six additional vector movement references and target-area guides are original
Aesthetic Lab artwork. Gym visual image/GIF files from the older metadata dataset
are not bundled or fetched by this application.

USDA FoodData Central SR Legacy reference nutrition (public domain) is included in
`aesthetic_lab/data/usda_foods.json`; original source URL, SHA-256 and processing
provenance are in `usda_provenance.json` and `scripts/import_usda.py`. Reference
values and portions are generic; they are not South African brand-label verification.

Two NutriTech label references in `aesthetic_lab/data/supplement_foods.json` are
Open Food Facts community database records, retrieved 2026-11-01. Source product
URLs, barcodes and attribution are retained with each row. They are not manufacturer
verification or generic values for every flavour. Open Food Facts database content
is available under ODbL: https://world.openfoodfacts.org/terms-of-use . This separate
data licence is retained in distributions of these records.

Selected flat exercise illustrations are from RepDB/exercise-dataset, pinned at
66c4298af8d99b9dc397dad6699e508fb871d249. Exercise data by RepDB (repdb.co):
https://repdb.co . These unmodified WebP assets are bundled for in-app use under
their separate free-tier licence, not AGPL. See
`aesthetic_lab/exercise_media/RepDB-LICENSE-DATA.md` and `RepDB-ATTRIBUTION.md`.
No standalone RepDB dataset, paid preview animations or AI-derived artwork is
distributed. The application's own vector diagrams are separate original work.

Six additional diet-plan food references are sourced from public nutrition tables
and manufacturer information, accessed 2026-11-02. Source URLs and preparation
qualifications are retained in `aesthetic_lab/data/diet_plan_foods.json`. They are
not taken from the PDF's approximate meal totals or represented as verified user
pack labels. The source archive does not include the user's original diet PDFs.
