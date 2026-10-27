# Isuka — Rwanda Agricultural Data Platform

Isuka makes Rwanda’s agricultural survey data easier to explore and use. It brings together public dashboards, district and crop views, seasonal forecasting, and an aggregate data query tool built around the National Institute of Statistics of Rwanda (NISR) Seasonal Agricultural Survey.

The public experience is designed to work without an account. Optional account features support farmer profiles and records. Survey outputs are served as aggregates; the platform does not expose respondent-level survey rows.

## What you can do

- Explore national and district agricultural indicators across survey years and seasons.
- Compare crops, production, cultivated area, yield, and recorded post-harvest loss.
- View district patterns on Rwanda maps and use the forecasting and methodology pages.
- Ask Isuka questions about the survey data and export supported aggregate results as CSV.
- Create a farmer account to manage farm records and access account features.
- Download the project’s public data exports where available.

## Project structure

| Path | Purpose |
| --- | --- |
| `backend/` | Express API, account features, data services, and tests |
| `frontend/` | Dashboard, forecasting, data query, and account pages; built with Vite |
| `www/` | Landing page and its static assets |
| `api/` | Serverless API entry point |
| `scripts/` | Data, artifact, and deployment helper scripts |
| `docs/` | Feature contracts and implementation notes |
| `DATA.md` | Data sources, measures, units, and caveats |
| `.env.example` | Environment variable template |

## Run locally

### Requirements

- Node.js 22 (see the `engines` field in `package.json`)
- npm
- Python 3 only for workflows that need the Python data pipeline

### Install and start

```bash
git clone https://github.com/isukaplatform-alt/Isuka-Data-Platform.git
cd Isuka-Data-Platform
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

The development command starts the API and Vite frontend together. The frontend is served at `http://localhost:5173`; the backend listens on its configured port (typically `3000`). Set `FRONTEND_ORIGIN` in your local environment if your frontend uses a different address.

Copy `.env.example` to `.env` and fill in only the values needed for the features you are developing. Account features require MongoDB configuration. Password-reset email requires valid Resend credentials and a verified sender. Optional assistant translation and weather providers are not required for the deterministic public data experience. Keep all secrets server-side and never commit `.env`.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start backend and frontend development servers |
| `npm start` | Start the backend server |
| `npm run build:frontend` | Build the Vite frontend |
| `npm run build:vercel` | Build the frontend and public directory, then verify artifacts |
| `npm test` | Run backend tests |
| `npm run verify:data` | Validate committed data artifacts and calculation versions |
| `npm run verify:artifacts` | Verify generated or deployed artifacts |
| `npm run evaluate:assistant` | Run the Ask Isuka evaluation set |

## Public data API

The dashboard and Ask Isuka use the Express API. Common public endpoints include:

| Method and path | Description |
| --- | --- |
| `GET /api/data/catalog` | Available crops, districts, periods, metrics, and coverage |
| `POST /api/data/query` | Validate and run an aggregate data request |
| `GET /api/data/query?...` | Query using URL parameters (permalink form) |
| `GET /api/data/export.csv?...` | Export aggregate query results as CSV |
| `POST /api/assistant` | Parse a natural-language question into a supported data request |

The query schema and limits are documented in [docs/assistant.md](docs/assistant.md). The API suppresses cells backed by fewer than 30 underlying records; it does not return survey microdata.

## Data and interpretation

The platform uses NISR Seasonal Agricultural Survey source files for 2020–2025. Reported figures are survey-based estimates and should be interpreted with the caveats attached to each measure. In particular, “recorded loss” describes loss reported in the survey; it is not a complete measure of total food waste. Missing combinations remain unavailable rather than being treated as zero.

See [DATA.md](DATA.md) for metric definitions, units, and data quality notes. Isuka is an independent project and its analysis is not an official NISR statement.

## Documentation

- [Data definitions and caveats](DATA.md)
- [Ask Isuka API and request schema](docs/assistant.md)
- [Ask Isuka evaluation notes](docs/assistant-evaluation.md)
- [Loss planner contract](docs/loss-planner-contract.md)
- [Implementation decisions](DECISIONS.md)
- [AI use disclosure](AI-USE-DISCLOSURE.md)

## Contributing

For changes to calculations or data artifacts, preserve the documented metric definitions and run `npm run verify:data`. For API or backend changes, run `npm test`. Keep credentials and raw sensitive data out of commits, and update the relevant documentation when endpoint behavior or data definitions change.

## Acknowledgements

Agricultural survey data is sourced from the National Institute of Statistics of Rwanda. Isuka is an independent platform and does not represent NISR.
