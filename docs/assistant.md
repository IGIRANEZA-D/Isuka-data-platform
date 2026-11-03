# Ask Isuka

Ask Isuka is a public, aggregate-only request interface. Its request schema is `{ metric, crop, districts, years, seasons, breakdown, compare?, format }`. Supported metrics are `production`, `area`, `yield`, `lossRate`, and `lossByStage`. Crop is a canonical crop code or `all`; districts are codes or `all`; years are 2020–2025; seasons are A/B/C or `all`; breakdown is `none`, `year`, `season`, `district`, `crop`, or `stage`. Stage results are returned only for confirmed kilogram groups from the existing Loss Planner aggregation; the response includes tonnes, each stage's share of recorded loss, record suppression, and period coverage.

## Endpoints

- `GET /api/data/catalog`: canonical observed crop and district selections, periods, metric descriptions, and aggregate record coverage.
- `POST /api/data/query`: validates and evaluates a request against the existing detailed aggregate series.
- `GET /api/data/query?...`: permalink form of the same request, with ETag caching.
- `GET /api/data/export.csv?...`: metadata and aggregate result rows; exports are capped at 5,000 rows.
- `POST /api/assistant`: public Ask Isuka intent router. Project questions receive a scoped text answer; data questions return a concise answer from verified aggregates; chart or table requests return the visualization result. Unsupported topics are refused.

Cells with fewer than 30 underlying records are suppressed. No survey microdata is returned. Every result includes a calculation version, selected periods, coverage grid, caveats, citation, and permalink. Citation format: “Source: NISR Seasonal Agricultural Survey ([periods]), processed by Isuka (calculation [calcVersion]). Not an official NISR statement.”

## Parsing and provider configuration

The deterministic parser is always available. Optional request translation uses `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` with an OpenAI-compatible chat-completions endpoint; `LLM_PROVIDER` is reserved for configuration display, and `LLM_DAILY_BUDGET` limits calls per server process per UTC day. The request contains only the question and catalog names/codes, uses structured tool output, has an 8-second timeout and 160-token limit, validates against the schema/catalog, caches normalized question hashes in memory, and silently falls back to deterministic parsing on failure or budget exhaustion.

Public project explanations use `GEMINI_API_KEY` and optional `GEMINI_MODEL`. The prompt is restricted to Isuka's platform, dashboard, NISR survey aggregates, metric definitions, and documented features. Gemini does not supply numeric survey results; those are computed by the deterministic query engine. Text questions stay text-only. A visualization is returned only when the user explicitly requests a chart, graph, table, or similar output, or uses the Build form. If Gemini is unavailable, the endpoint returns a concise service message. Never place identity or raw survey records in a model request. User questions are not written to application logs.

## Evaluation

See [assistant-evaluation.md](assistant-evaluation.md) for the deterministic evaluation set and measured results. Human review of Kinyarwanda aliases remains outstanding.
