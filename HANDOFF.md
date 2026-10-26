# Isuka Landing Page Handoff

## Completed
- Kept the existing `www/landing.html` page, lower content sections, and dashboard/account routes.
- Restyled the navigation and opening hero around the supplied Isuka reference.
- Added a live, data-colored Rwanda district map with contours, district boundaries, loss dots, ranked labels, and a farmer illustration.
- Added the field-to-market journey graphic with animated route and five stages.
- Added a 30-district loss explorer with year and season controls, KPIs, accessible district tiles, and a table view.
- Generated `frontend/data/landing-art.json` from the published 30-district boundary data. The build output is about 65.8 KB gzip; the terrain layer is about 30.1 KB gzip.
- Added `/data/landing-art.json` static delivery and the `/api/landing/summary` endpoint. The endpoint previously returned 200 with a 12,359-byte gzip response, under its 20 KB cap.
- Kept the landing summary aligned with the existing overview API for the checked years/seasons.
- Browser previews were captured at desktop and mobile dimensions; desktop hero, live map labels, and the journey layout render.
- The landing page now loads the same Baloo 2 and Work Sans font families used by the dashboard. Its hex map displays loss percentages inside the tiles and a nearby live readout for district names/ranks; its three summary cards use aligned labels, responsive values, and subtle hover motion.
- Dashboard map pages now load the local SVG district-map renderer instead of depending on the unavailable external Leaflet CDN. `/api/rwanda-districts` serves the existing 30-district landing geometry locally, with the original GIS source retained as a fallback. The generated single-part Polygon coordinates are now correctly nested so district shapes render together as Rwanda rather than as disconnected fragments.
- The district tiles display each available loss percentage inside its hex and show the requested hover/focus hint below the tiles. The survey period label now sits below the map instead of overlapping the loss legend.
- Hovering or focusing a hero district or data point highlights its boundary and opens a small animated data callout with its loss rate, year, and rank.

## Remaining environment notes
- `npm.cmd --prefix frontend run build` previously failed in Vite/esbuild with `Access is denied` while reading `../../../..`; the landing page itself is served from the existing `www/landing.html` route.
- `npm run verify:data` now explicitly enumerates backend test files for Windows and includes an Ask Isuka reconciliation check against existing Overview calculations. The latest full run is still in progress.
- This workspace has no `.git` directory, so a git baseline/status comparison is unavailable.
- LCP, CLS, and TBT have not been measured. API validation returned 30 uniquely named district features and 3,780 finite coordinates covering Rwanda's approximate longitude/latitude bounds; the dashboard pages still need a full interactive browser pass in this environment.

## Ask Isuka (2026-10-24)

### Done
- Added additive `backend/src/data/query-engine/` request validation, aggregate query output, catalog, coverage grid, suppression threshold, citation, GET permalink/ETag, and aggregate CSV endpoint with 5,000-row cap. Confirmed stage-loss results reuse the Loss Planner aggregation and report tonnes plus share of recorded loss.
- Added `/api/assistant` with deterministic English parsing and an optional structured LLM translator, 300-character limit, fixed refusal, daily in-process LLM budget, hashed in-memory response cache, 8-second timeout/fallback, and per-IP rate limit. User questions are not logged.
- Added shared Ask Isuka drawer UI, form/chat tabs, aggregate SVG chart/table, CSV/SVG/PNG/citation/link actions, missing-coverage grid, alternatives, and the original `www/ISUKA BOT.png` on the eight public dashboard pages only.
- Added `README.md`, `DATA.md`, `docs/assistant.md`, `docs/assistant-evaluation.md`, `.env.example`, and `AI-USE-DISCLOSURE.md`. Added an 84-question deterministic evaluation set and runner covering in-scope queries and safety cases.
- `npm test` passes (56 tests). Direct API smoke checks on port 3001 returned a complete 30-district result, a matching GET permalink, and confirmed 2025 Ngoma/Maize stage totals with period-level coverage. Assistant static assets and mascot returned HTTP 200. Gzip is negotiated on JSON/CSV routes.
- Expanded parser evaluation measures 100% exact request match on 76 supported requests and 100% clarification/refusal outcomes across 84 cases, including comparisons, breakdowns, ambiguity, injection, personal-data requests, and draft Kinyarwanda aliases. Seven output comparisons reconcile with the existing Overview calculations.

### UI polish (2026-10-26)
- Brand-aligned drawer: Baloo 2 / Work Sans, #3D6B1F / #6FA83C / #F4F6F1 / #1F2E17, soft green context bar, white header/composer, primary Send/Run.
- Ask is a scrollable chat transcript with sticky composer; typing dots match account assistant; greetings no longer dump charts (“hey” was fuzzy-matching Huye).
- Multi-metric Ask (e.g. production + loss) returns the first measure then related cards; chart-style questions work in Ask, not only Build.
- Build: structured form panel; result below Run. Answer actions: CSV/SVG/PNG/Cite/Link.

### In progress / acceptance gaps
- Browser visual, keyboard, mobile and accessibility checks were not run because browser automation tooling is unavailable in this environment.
- The optional LLM adapter has mock tests but has not been tested against a real provider. Budget state is per server process, not shared across a multi-process deployment. Kinyarwanda aliases are draft and require the named teammate review. The 2026-A forecast query metric is not implemented; forecast values are not fabricated or exposed.
- Tier 2 fixed chart explanation files are not complete. District Explorer/Loss Planner apply bridges are not added.
- Tier 3 year-on-year area/yield decomposition is not started.
- The 60-case evaluation is intentionally narrow (English, exact names, 2025, seasons A–C); its 100% is not representative of the broader requested evaluation coverage.

### Next
- Complete browser keyboard, mobile, accessibility and visual checks when a browser automation environment is available.
- Have a Rwandan teammate review every Kinyarwanda alias before relying on it in production. Configure a real LLM provider only if wanted, with a provider-side spending cap and accurate disclosure.
- Implement forecast-cache and year-on-year decomposition only after confirming source metadata and preserving uncertainty and coverage warnings.

### Human TODO
- If enabling an LLM later, configure `LLM_*` variables and a hard spending cap in the provider dashboard; ask a Rwandan teammate to review Kinyarwanda aliases; update AI-use disclosure to name the provider/model actually used.
