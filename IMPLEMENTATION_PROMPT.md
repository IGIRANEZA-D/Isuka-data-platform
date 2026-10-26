# Isuka Dashboard Implementation Prompt

You are working on the Isuka agricultural data platform in this workspace:

`c:\Users\USER\Videos\IG TECK SOLUTION\ISUKA`

## Objective

Turn the existing Isuka prototype into a trustworthy, data-backed full-stack application.

The immediate scope is the landing page and the first dashboard screen: **Overview**. Do not build the remaining dashboard sections yet. Make the foundation correct so later sections can reuse the same data and API contracts.

## Non-negotiable product requirements

1. Preserve the original Isuka landing page design.
   - The landing page was designed with photography, video, branding, and a clean visual composition.
   - Inspect all existing assets in `www/`, especially `Landing page Video.mp4`, `Landing-page.jpg`, `Third photo on landing page.jpg`, `ISUKA LOGO.png`, `ISUKA ON HAND.jpg`, and related images.
   - If the original landing HTML is missing, reconstruct the intended landing experience from the available assets and existing project history instead of replacing it with a plain placeholder page.
   - The landing page must be the public entry point.
   - It must have a clear action that opens the dashboard overview.
   - The dashboard must have a clear action that returns to the landing page.

2. Preserve the existing dashboard visual direction.
   - The current first navbar/sidebar and overview UI are the approved starting point.
   - Keep the existing visual language, spacing, colors, imagery, typography direction, cards, and layout unless a change is required for usability or correctness.
   - Do not replace the overview with a generic admin template.
   - Keep the Overview screen as the first working dashboard route.
   - The other navigation items may remain disabled, marked as coming later, or routed to placeholders, but they must not pretend to provide data they do not yet provide.

3. Use real data from the datasets in `www/Datasets(2020-2025)`.
   - Do not use invented, static, demo, or hard-coded KPI values.
   - Treat the files as source data, not as presentation data.
   - Inspect the dataset explanation and real headers before defining calculations.
   - Support the actual file format. Some files have a `.csv` extension but are tab-delimited.
   - Handle quoted values, missing values, malformed rows, numeric fields with commas, and inconsistent column names safely.
   - Never silently treat an unavailable value as zero when that would misrepresent the data.
   - Show a clear unavailable state when a metric cannot be calculated.

4. Move data processing into the backend.
   - The browser should not independently fetch and aggregate several large raw files.
   - Create a backend service with a documented API used by the frontend.
   - The backend should discover or explicitly configure the supported production files, parse them, normalize their fields, calculate metrics, and return JSON.
   - Keep raw dataset paths and parsing rules on the backend.
   - Do not expose filesystem implementation details in the UI.

5. Make the calculations defensible.
   - Define canonical fields for year, season, district, crop, crop area, yield, production, survey weight, and post-harvest loss.
   - Verify every canonical field against the real source headers and dataset explanation.
   - Document the unit of every returned metric.
   - Use survey weights only where the dataset methodology supports weighting.
   - Do not label an observed weighted production total as a forecast.
   - Do not call survey response fields kilograms or percentages without verifying their meaning.
   - For every KPI, document the formula and source fields in backend code or API documentation.
   - Include data quality metadata in the API response: source files, periods loaded, row counts, missingness, invalid rows, and last calculation time.

6. Build a stable Overview API.

   Suggested endpoints:

   - `GET /api/health`
   - `GET /api/overview`
   - `GET /api/overview?year=2025&season=C`
   - `GET /api/metadata`

   The overview response should contain, at minimum:

   ```json
   {
     "period": { "year": 2025, "season": "C" },
     "kpis": {
       "weightedProductionKg": null,
       "arableLandHa": null,
       "postHarvestLossPercent": null,
       "districtCount": 0,
       "highRiskDistrictCount": 0
     },
     "trends": {},
     "productionByCrop": [],
     "riskDistribution": [],
     "dataQuality": {
       "sourceFiles": [],
       "rowsRead": 0,
       "rowsUsed": 0,
       "invalidRows": 0,
       "warnings": []
     }
   }
   ```

   Use `null` when a value is not valid or unavailable. Do not fabricate zero values.

7. Connect the frontend only to the API.
   - Replace direct browser fetches of raw dataset files with calls to the backend API.
   - Add loading, empty, error, and partial-data states.
   - Display the active period and data source/status in the Overview.
   - Ensure the charts and KPI cards update from the API response.
   - Keep chart labels honest: observed production, weighted production, reported loss, or forecast must be distinct concepts.
   - Make the return-to-landing link work under the local development server.

## Required project setup

Use an npm-based development workflow that I can run myself.

Preferred structure:

```text
ISUKA/
  package.json                # root scripts for running both services
  frontend/
    package.json
    ...
  backend/
    package.json
    src/
      server.js
      routes/
      services/
      data/
    ...
  www/
    ... raw datasets and landing assets ...
```

Use a conventional, maintainable stack that fits the existing project. A simple Express backend and the existing frontend structure are acceptable. If the frontend is migrated to Vite, preserve the existing UI rather than recreating it from scratch.

The root scripts must support:

```bash
npm install
npm run dev
```

`npm run dev` must start both the backend and frontend with one command. Use a reliable process runner such as `concurrently`, or provide an equally clear cross-platform solution.

Also provide these individual commands:

```bash
npm run dev:backend
npm run dev:frontend
npm run test
```

The frontend must use a configurable API base URL, such as `VITE_API_BASE_URL`, and local development must work without manually editing source files.

## Backend requirements

- Use an explicit dataset configuration rather than fragile path guessing.
- Resolve paths relative to the repository root, not a developer-specific absolute path.
- Avoid loading every raw file into memory on every browser request if a cached in-memory calculation or startup refresh is appropriate.
- Add a refresh or reload strategy that is simple and documented.
- Return useful HTTP errors and structured error JSON.
- Enable CORS only for the local frontend origin during development.
- Add tests for parsing, numeric conversion, missing fields, period selection, aggregation, and at least one known real dataset result.
- Do not modify or overwrite raw files.

## Frontend requirements

- Keep the existing Overview layout and approved navbar/sidebar.
- Add accessible navigation back to the landing page.
- Use semantic HTML and keyboard-accessible controls.
- Keep the interface responsive on desktop and mobile.
- Do not show a chart when its data is empty; show a meaningful empty state.
- Do not use decorative numbers that are not returned by the API.
- Keep future dashboard sections visibly separate from the working Overview.

## Validation checklist

Before declaring the work complete:

1. Run `npm install` successfully.
2. Run `npm run test` successfully.
3. Run `npm run dev` successfully.
4. Confirm the landing page loads with its intended imagery/video and opens Overview.
5. Confirm Overview loads data from the backend API, not from raw files in browser JavaScript.
6. Confirm `/api/health` reports healthy.
7. Confirm the API response identifies the source period, source files, row counts, and warnings.
8. Confirm at least one displayed KPI can be traced to real source columns and a documented formula.
9. Confirm missing or invalid data produces a clear state rather than a misleading value.
10. Confirm the dashboard return link navigates back to the landing page.
11. Check browser console and network requests for errors.
12. Do not claim a metric is valid until its source-field meaning and unit have been verified.

## Delivery expectations

At the end, provide:

- The files changed and why.
- The exact install, development, and test commands.
- The local URLs for the landing page, frontend, and backend health endpoint.
- The API response shape and metric formulas.
- Any unresolved dataset-definition questions.
- A short list of what is intentionally deferred until the Overview is approved.

Do not build Climate & Risk, Land & Crops, Inputs & Practices, Market Trends, or District Explorer until the Overview data contract and calculations have been reviewed and accepted.

## Master continuation prompt for the next AI developer

Use this section as the authoritative handoff if another AI continues this project. The person requesting the work wants a professional, coherent product, not disconnected prototype pages.

### Product vision

Isuka is a Rwanda agricultural intelligence platform. It should feel like one complete application from the moment a person opens the local URL:

1. The person lands on the designed Isuka landing page.
2. They can understand the product from the photography, video, branding, and concise copy.
3. They click one clear action to enter the dashboard.
4. They arrive at the Overview screen with real information calculated from the local agricultural datasets.
5. They can move through the application without losing context.
6. They can always return to the landing page.
7. The backend and frontend communicate through a documented API.
8. The visible numbers are traceable to source fields, formulas, units, periods, and data-quality warnings.

The application must feel intentionally designed and trustworthy. Do not make it look like a generic generated admin dashboard. Do not replace the approved visual direction with a new unrelated design system. Improve the existing work carefully and preserve its identity.

### Current repository facts

The repository is:

`c:\Users\USER\Videos\IG TECK SOLUTION\ISUKA`

Important folders and files currently include:

- `www/`: landing assets and the raw datasets.
- `www/Landing page Video.mp4`: landing hero video.
- `www/Landing-page.jpg`: landing hero/poster image.
- `www/Third photo on landing page.jpg`: additional landing visual.
- `www/ISUKA LOGO.png`, `www/isuka-logo.png`: brand assets.
- `www/Navbar background.jpg`: dashboard sidebar visual.
- `www/Overview.jpg`: dashboard overview banner visual.
- `www/Datasets(2020-2025)/`: agricultural source data.
- `frontend/index.html`: existing approved Overview layout and first navbar/sidebar.
- `frontend/styles.css`: existing Overview visual styling.
- `frontend/dashboard.js`: should remain API-driven and must not read raw data files.
- `backend/src/server.js`: backend API entry point.
- `backend/src/data/parser.js`: backend delimiter and numeric parsing.
- `backend/src/data/dataset-config.js`: explicit source-file configuration.
- `backend/src/data/overview-service.js`: canonical field mapping and Overview calculations.
- `backend/test/overview.test.js`: backend tests.
- `www/index.html`: public landing page entry point and landing assets.
- `package.json`: root scripts for running both applications.

Read these files before changing architecture. Work with existing user changes. Do not delete the current Overview layout, landing assets, dataset files, or useful backend work just because a cleaner-looking rewrite is tempting.

### The most important architectural requirement: one connected application

The landing page, dashboard, navigation, assets, API, and local development workflow must be joined into one predictable application.

The user should not have to guess whether they opened a separate page, a separate server, or an old prototype. There should be one documented public entry URL and consistent routes.

Preferred local experience:

```text
http://localhost:5173/              landing page
http://localhost:5173/dashboard     Overview dashboard
http://localhost:5173/api/health    backend health through the dev proxy
http://localhost:5173/api/overview  backend Overview API through the dev proxy
```

The implementation may use:

- Vite frontend on port 5173.
- Express backend on port 3000.
- A Vite development proxy from `/api` to `http://localhost:3000`.
- A frontend route for `/` that renders the landing page.
- A frontend route for `/dashboard` that renders the existing Overview.

Alternatively, a single Express server may serve the built frontend and API from one origin. Choose one approach and make it consistent. Do not leave the landing page at one unrelated URL, the dashboard at another unrelated URL, and the API at a third undocumented URL.

If the project keeps static HTML instead of adding a router, the minimum acceptable behavior is:

- `/` opens the landing page.
- `/dashboard` opens the dashboard.
- The landing CTA links to `/dashboard`.
- The dashboard back control links to `/`.
- Both routes work from the same local development server.
- Refreshing either route does not produce an unexplained 404.

Do not use hard-coded links to a developer-specific filesystem path. Do not require the user to open `www/index.html` manually. Do not require the user to remember that the API runs on a different host just to view the dashboard.

### Landing page recovery and preservation

The original landing page design matters. The user specifically remembers a clean landing page with photo, video, branding, and designed composition. Treat that as an existing product requirement even if the original HTML file is missing.

Before editing the landing page:

1. Inspect every relevant image and video asset in `www/`.
2. Inspect image dimensions and aspect ratios where useful.
3. Search the workspace and any available history for old landing markup, class names, copy, or references to those assets.
4. Reconstruct the visual hierarchy from the assets instead of making a plain text page.
5. Keep the landing page responsive and readable over the media.

The landing page should include:

- Isuka branding/logo.
- The existing video as a background or hero media where appropriate.
- A poster/fallback image for browsers that do not autoplay video.
- A clear, prominent CTA to the dashboard Overview.
- A concise explanation of the platform without excessive marketing filler.
- A visible visual relationship to Rwanda and agriculture.
- Good contrast, semantic structure, keyboard navigation, and reduced-motion consideration.
- No fake statistics or unsupported claims.

The landing page must not be replaced with a placeholder containing only a heading and button. The supplied assets are part of the product and must be used intentionally.

### Dashboard preservation and navigation

The current Overview has an approved first sidebar/navbar with these sections:

- Overview
- Land & Crops
- Climate & Risk
- Inputs & Practices
- Market Trends
- District Explorer

Keep this first navigation visually recognizable. The Overview is the only fully implemented dashboard section in this phase.

For sections that are not implemented yet:

- Keep the navigation visible if it matches the approved design.
- Make unavailable sections clearly disabled or label them as coming later.
- Do not make a disabled item look like it successfully opened a real data view.
- Do not invent metrics for future sections.
- Do not route to an empty page without explaining the state.

The Overview must have:

- A clear back-to-home control.
- An active Overview state in the sidebar.
- Loading state before the API response arrives.
- Error state when the API is unavailable.
- Empty or partial-data state when the API returns insufficient data.
- Active period shown clearly.
- Data source/status shown clearly but without exposing raw filesystem paths as user-facing implementation details.
- Honest labels such as “Weighted production”, “Reported loss”, and “Production by crop”.
- No label saying “forecast” unless a real forecast model exists.

### Real data requirements

The user wants real information, real calculations, and real communication between frontend and backend.

The browser must not fetch these raw files directly:

- `Rwa_raw_SeasonA2024_Production.csv`
- `Rwa_raw_SeasonB2024_Production.csv`
- `Rwa_raw_SeasonC2024_Production.csv`
- `Rwa_raw_SeasonA2025_Production.csv`
- `Rwa_raw_SeasonB2025_Production.csv`
- `Rwa_raw_SeasonC2025_Production.csv`

The backend owns those files and the calculations. The frontend calls `/api/overview` and renders the JSON response.

The current real production files are tab-delimited even though some use a `.csv` extension. The parser must detect the delimiter and correctly handle:

- Tab-delimited files.
- Comma-delimited files where encountered.
- Quoted values.
- Embedded delimiters inside quoted values.
- Byte-order marks.
- Missing cells.
- Rows with the wrong number of columns.
- Numeric values containing commas.
- Negative values requiring validation.
- Different schemas across years.

Never hide a data-quality problem by converting every missing or invalid value to zero. Use `null`, exclude the affected row from a specific calculation, and add a warning explaining what happened.

### Canonical data contract

The backend must normalize source schemas into a canonical internal record. At minimum, define:

- `year`
- `season`
- `districtCode`
- `districtName` when available
- `farmerId` when available
- `plotNumber` when available
- `cropCode` when available
- `cropName`
- `plotAreaHa`
- `cropAreaHa`
- `yieldKgPerHa` or the verified source unit
- `surveyWeight`
- `reportedProductionKg` where directly available and verified
- `lossComponents`

Do not assume the same question number has exactly the same meaning in every year. Use the dataset explanation and a field dictionary. Where a year is not comparable, report that limitation in `warnings` rather than forcing an incorrect comparison.

District joins should use stable district codes where available. Do not rely only on display names because the source contains a known 2025 spelling variation such as `Nyarugenge`/`Nyarugenege`.

### Calculation rules

Every displayed metric needs a documented formula and unit.

The following are acceptable only after verifying the source fields and units:

```text
weighted production = crop area in hectares * yield in kg per hectare * survey weight

weighted land area = plot area in hectares * survey weight

reported loss percentage = valid non-negative reported loss quantity * survey weight
                         / weighted production * 100
```

Important calculation rules:

- Prefer a verified direct production field when it is methodologically more appropriate than reconstructing production from area and yield.
- Do not double-count a total loss field and its component fields in the same sum.
- Do not call all `s2q41`–`s2q49` values kilograms without checking the year-specific field definitions.
- Exclude negative loss quantities from totals and report how many rows were affected.
- If production is zero or unavailable, loss percentage is `null`, not infinity and not zero.
- If the survey weight is missing, do not silently substitute `1` for a national estimate. Either exclude that row from weighted estimates or expose an explicitly documented unweighted fallback.
- If a comparison period is unavailable or not comparable, trend values must be `null`.
- Risk tiers must be described as data-derived loss tiers or reported-risk tiers, not as measured climate risk unless external climate data is added.
- The existing datasets do not contain measured daily rainfall, temperature, drought indices, satellite measurements, or flood event data. Do not imply that they do.

### API requirements

Implement and document these endpoints:

```text
GET /api/health
GET /api/metadata
GET /api/overview
GET /api/overview?year=2025&season=C
POST /api/refresh
```

The Overview response should be stable and include:

```json
{
  "period": { "year": 2025, "season": "C" },
  "kpis": {
    "weightedProductionKg": 0,
    "arableLandHa": 0,
    "postHarvestLossPercent": null,
    "districtCount": 0,
    "highRiskDistrictCount": 0
  },
  "trends": {
    "weightedProductionPercent": null,
    "arableLandPercent": null,
    "postHarvestLossPercent": null
  },
  "productionByCrop": [
    { "crop": "Maize", "productionKg": 0, "rows": 0 }
  ],
  "riskDistribution": [
    { "tier": "low", "districtCount": 0 },
    { "tier": "moderate", "districtCount": 0 },
    { "tier": "high", "districtCount": 0 }
  ],
  "dataQuality": {
    "sourceFiles": [],
    "periodsLoaded": [],
    "rowsRead": 0,
    "rowsUsed": 0,
    "invalidRows": 0,
    "warnings": [],
    "calculationTimestamp": "",
    "units": {},
    "formulas": {}
  }
}
```

Use `null` for unavailable metrics. An empty array is appropriate for an empty breakdown. Avoid making the API pretend that no data and zero data mean the same thing.

### Development workflow the user must be able to run

The user wants to install and run the project themselves. Make the commands work on Windows PowerShell as well as ordinary npm environments.

From the repository root:

```bash
npm install
npm run dev
```

The combined command must start both services and keep the output understandable. Also support:

```bash
npm run dev:backend
npm run dev:frontend
npm run test
npm run build
```

The root `package.json` should use a dependable process runner such as `concurrently` for the combined command. The backend should run on port 3000 by default. The frontend should run on port 5173 by default. Make ports configurable through environment variables where practical.

Configure the frontend API base through a development-safe mechanism such as a Vite proxy or `VITE_API_BASE_URL`. Prefer relative `/api` requests in the browser when a proxy is available, because that keeps the visible app on one origin.

Document the exact URLs after startup. The user should not need to start a separate Python server or manually open files under `www/`.

### Testing and validation order

Follow this order and show the result:

1. Inspect source headers and the dataset explanation.
2. Run `npm install`.
3. Run parser and aggregation unit tests.
4. Run `npm run test`.
5. Run `npm run build`.
6. Run `npm run dev`.
7. Request `/api/health`.
8. Request `/api/metadata`.
9. Request `/api/overview`.
10. Open `/` in a browser and verify the landing visual assets load.
11. Click the landing CTA and verify it opens `/dashboard`.
12. Verify Overview KPI cards and charts contain API values.
13. Verify the browser network panel shows API requests and does not show raw dataset fetches from dashboard JavaScript.
14. Click the Overview back-to-home control and verify it returns to `/`.
15. Test a missing-data or invalid-period response.
16. Check the browser console for errors.
17. Test desktop and mobile widths.

The browser-level acceptance test should verify real text, not only HTTP status codes. It should see the active period, at least one non-placeholder KPI, production chart content, and the landing-page CTA.

### Professional quality bar

The result should be:

- Cohesive: landing, dashboard, routes, API, and assets feel like one product.
- Honest: every number has a source and formula.
- Robust: missing or malformed data produces warnings and usable states.
- Maintainable: paths are repository-relative and configuration is explicit.
- Accessible: controls have labels, focus states, semantic structure, and readable contrast.
- Responsive: the landing page and Overview work on mobile and desktop.
- Focused: only Overview is implemented deeply in this phase.
- Reversible: future dashboard sections can reuse the backend contract.
- Testable: parser, calculations, API, routes, and build have executable checks.

Avoid:

- Hard-coded KPI numbers.
- Browser-side raw dataset parsing.
- A second disconnected landing page.
- Broken relative links that only work from one directory.
- Fake climate measurements.
- Fake forecast language.
- Silent fallback from missing data to zero.
- Rebuilding the approved UI into a generic template.
- Implementing unfinished nav sections as if they were complete.
- Leaving long-running development servers running when the task is finished unless the user asked for them to stay running.

### Final handoff format

At the end of the implementation, report:

1. What was changed, grouped by landing page, routing, frontend, backend, and tests.
2. Exact commands the user can run:

   ```bash
   npm install
   npm run dev
   npm run test
   npm run build
   ```

3. Exact local URLs:

   ```text
   landing page: http://localhost:5173/
   dashboard:    http://localhost:5173/dashboard
   health:       http://localhost:5173/api/health
   overview API: http://localhost:5173/api/overview
   ```

4. The Overview response shape.
5. The formulas and source fields used for every displayed KPI.
6. The source period and row counts observed during validation.
7. Warnings or unresolved dataset-definition questions.
8. What was intentionally deferred until the Overview is approved.
9. Any known limitation, with a concrete next action.

Do not claim the application is complete merely because the server starts. Completion means the user can open one local application, navigate from landing to dashboard and back, see real API-backed values, understand the data status, and run the documented commands independently.

## Landing page recovery instruction based on the supplied reference

The supplied reference image is the intended original landing page. The current simplified `www/index.html` is not the original design and must be treated as an incomplete replacement. Recover the original landing experience without deleting or damaging the dashboard.

### Critical instruction to the next AI

Do not respond by saying the landing page is already complete. It is not. Do not keep the current minimal landing page as the final result. Rebuild the landing page to match the supplied reference as closely as possible using the existing assets and project files.

Do not delete:

- `frontend/index.html`
- `frontend/dashboard.js`
- `frontend/styles.css`
- `backend/src/server.js`
- `backend/src/data/`
- `backend/test/`
- Any raw dataset under `www/Datasets(2020-2025)`

The dashboard must remain available as a separate route and must continue to use real backend data. The goal is to restore the landing page alongside the dashboard, not to replace the dashboard with the landing page.

### Reference screenshot structure to reproduce

The original page shown in the reference is a tall, polished, responsive landing page with the following structure. Recreate this structure in the same order:

1. **Top navigation bar**
  - Isuka logo on the left.
  - Navigation links similar to:
    - Features
    - How It Works
    - Impact
    - Market Trends
    - Dashboard
  - Login action.
  - Green “Get Started” action.
  - Desktop navigation that becomes an accessible mobile menu on small screens.
  - The Dashboard and Get Started actions must open the working dashboard Overview route.

2. **Hero section**
  - Large agricultural field image with warm sunlight.
  - Phone mockup held over the field showing the Isuka product.
  - Strong Isuka headline and supporting copy positioned over or adjacent to the hero visual according to the original composition.
  - A clear primary CTA to get started/open the dashboard.
  - Use the existing relevant assets in `www/`, including the landing image, phone/product images, logos, and video where it improves fidelity.
  - Keep text readable over the image with an intentional overlay or layout treatment.

3. **How it works section**
  - Centered heading: “How it works”.
  - Supporting sentence about securing the agricultural future with trusted data.
  - Three horizontally arranged cards on desktop and stacked cards on mobile:
    - Register your farm.
    - Get personalized alerts.
    - Act before loss happens.
  - Each card has an icon, a short description, and a subtle numbered/background treatment similar to the screenshot.

4. **Product/farmer capability section**
  - A product image showing the Isuka platform on a tablet or device.
  - Heading similar to “Built for the modern Rwandan farmer”.
  - Supporting copy.
  - A short list of real product capabilities, such as localized weather forecasting, pest and disease detection alerts, input-supplier links, and historical yield benchmarking.
  - A link/action to explore platform features, which may point to the working dashboard until other sections are implemented.

5. **Live national trends section**
  - Heading similar to “Live national trends”.
  - Supporting copy describing aggregated data insights.
  - A “See full dashboard” action linking to the Overview dashboard.
  - A visual analytics area with a chart-style panel and supporting metric cards.
  - Do not use invented values in this section if numbers are displayed as real information. Use the backend Overview API or label any visual as a non-data decorative preview.
  - Prefer real API-backed values from the same data contract used by the dashboard.
  - Clearly distinguish observed weighted production from climate risk or forecast values.

6. **Rwanda impact section**
  - Strong green full-width band.
  - Heading similar to “Empowering the backbone of Rwanda’s economy”.
  - Large impact statistic only if its source is verified. Otherwise use a qualitative statement or a clearly labelled platform fact.
  - Image of Rwandan farmers from the supplied assets.
  - A testimonial or profile panel only if the supplied content/assets support it. Do not invent a real person’s quote or identity.

7. **Final CTA section**
  - Heading similar to “Start protecting your harvest today”.
  - Supporting copy.
  - Green “Get Started Now” action linking to the working dashboard.
  - Secondary “Contact Sales” action only if it has a meaningful destination or mail link.

8. **Footer**
  - Isuka branding.
  - Short company/platform description.
  - Platform links.
  - Resources links.
  - Contact information only when supported by existing project content.
  - Footer navigation links must not point to dead or misleading routes.
  - Dashboard links must open the dashboard route.
  - Privacy and policy links may be visibly present as placeholders only if clearly marked or backed by pages.

### Asset recovery process

Before coding the replacement landing page, follow this exact process:

1. Search the entire workspace for old landing markup, recognizable copy, asset filenames, classes, and routes.
2. Inspect the dimensions and visual content of all relevant files in `www/`.
3. Check whether there is an older copy in `www/Whole Dashboard/`, generated output, a previous build directory, browser cache, or any available local history.
4. Search for the reference design’s visible phrases, including:
  - “How it works”
  - “Register your farm”
  - “Get personalized alerts”
  - “Act before loss happens”
  - “Built for the modern Rwandan farmer”
  - “Live national trends”
  - “Empowering the backbone of Rwanda’s economy”
  - “Start protecting your harvest today”
5. If the original source is not recoverable, reconstruct the page from the screenshot and existing assets. State clearly that it was reconstructed.
6. Keep the implementation in a maintainable location. Do not bury a complete landing page inside an unrelated dashboard script.

### Route and file recovery rules

The previous implementation accidentally created a simplified public page and left the dashboard as a separate page. Reverse that behavior.

The target is:

```text
/                  original-style Isuka landing page
/dashboard         existing Overview dashboard
```

The landing page must not link to `www/index.html` as a separate manual file when running the application. The dashboard must not link to a raw file path. Use application routes.

When using Vite:

- Configure a route-aware entry for `/` and `/dashboard`, or use a small router while preserving the current plain HTML/CSS style.
- Configure `server.fs.allow` or move/copy only approved public assets so dashboard images load without 403 errors.
- Prefer serving public images and video from a frontend public directory or through a backend/static asset route.
- Configure a development proxy for `/api` to the backend.
- Make browser refresh work at both `/` and `/dashboard`.

When using Express to serve the built application:

- Serve the landing route at `/`.
- Serve the dashboard route at `/dashboard`.
- Serve the API under `/api`.
- Serve approved media assets without exposing arbitrary filesystem browsing.
- Add a fallback for frontend routes if using client-side routing.

### Navigation acceptance tests for the recovered page

The next AI must verify all of the following in a real browser:

1. Opening the documented local root URL shows the full landing page, not the dashboard and not a minimal placeholder.
2. The top navbar is visible and responsive.
3. The hero image/video and relevant product/phone visual load.
4. “Dashboard” in the navbar opens `/dashboard`.
5. “Get Started” opens `/dashboard`.
6. “See full dashboard” opens `/dashboard`.
7. The dashboard Overview loads with real API values.
8. The dashboard home/back action returns to `/`.
9. Refreshing `/` works.
10. Refreshing `/dashboard` works.
11. No navigation action opens a dead `file:///` URL, a raw `www/index.html` URL, or an old port that is not part of the documented workflow.
12. The browser console has no 403 errors for dashboard images, 404 errors for landing assets, or failed API requests.
13. Mobile navigation opens, closes, and remains keyboard accessible.
14. All major landing sections are present and visually readable at desktop and mobile widths.

### Dashboard protection checklist

Before and after recovering the landing page, verify:

- Overview still renders the same approved sidebar/navbar.
- Overview still calls `/api/overview` instead of raw dataset URLs.
- KPI values still come from the backend response.
- Production chart still uses real `productionByCrop` data.
- Risk distribution still uses API-returned district tiers.
- Loading/error/empty states still work.
- The back-to-landing control uses `/`, not a filesystem-relative path.
- Dashboard CSS and landing CSS do not accidentally override each other.
- Landing page changes do not remove or rename dashboard assets.

### Final instruction to the next AI

Treat the screenshot as a product reference and the current repository as a partially damaged implementation. Recover the landing experience first, but preserve the dashboard and backend. Do not erase working code to make the task appear simpler. Make both experiences available in one application, with reliable routes, real API communication, and clear navigation in both directions.
