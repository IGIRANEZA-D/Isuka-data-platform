# Isuka Backend

## MongoDB

The backend uses MongoDB for application records. Copy `.env.example` to `.env` and set `MONGODB_URI` and `MONGODB_DATABASE` for the local MongoDB server or MongoDB Atlas deployment. Keep credentials in the backend environment only; never expose the URI through frontend configuration or commit a populated `.env` file.

For MongoDB Atlas, confirm the cluster is running, the database user has the required read/write permissions, the deployment host's outbound IP is allowed by the Atlas Network Access list, and the deployment can resolve and reach the cluster host over TLS. A database connection timeout is commonly caused by network access or DNS configuration; increasing the timeout does not fix a blocked connection.

Connection pool and timeout settings can be tuned with the `MONGODB_*` values in `.env.example`. Defaults use a bounded pool, finite wait-queue timeout, retryable reads/writes, and a short cooldown after a failed initial connection to avoid a connection storm.

In development, the HTTP server can start while MongoDB is unavailable so static pages and health checks remain reachable; database-backed operations remain unavailable until the database reconnects. In production (`NODE_ENV=production`), `MONGODB_URI` and `MONGODB_DATABASE` must be explicitly configured and startup fails rather than serving traffic without the database. Set `FRONTEND_ORIGIN` to the exact deployed frontend origin for credentialed browser requests. Use `GET /api/health/live` for a process liveness probe and `GET /api/health/ready` for a database-backed readiness probe; readiness returns HTTP 503 until MongoDB and its required collections/indexes are available.

On shutdown, the backend stops accepting new requests, drains active requests, and closes the MongoDB client. Deployments should send `SIGTERM` and allow at least 10 seconds for graceful shutdown.

Uploaded dataset files and source datasets are stored on disk, not inside MongoDB. On hosts with ephemeral filesystems, mount persistent storage and set `ISUKA_UPLOADS_DIR` and (if the source datasets are outside the app image) `ISUKA_DATASETS_DIR` to absolute paths. Without persistent storage, uploaded files can disappear on redeploy even though their MongoDB records remain.

The initial collections are `users`, `datasets`, `uploads`, and `validationReports`. Dataset files remain in filesystem storage while MongoDB stores their registry, upload status, and validation metadata.

The current completed database flow is:

1. Backend startup seeds the configured source periods into `datasets` without overwriting uploaded statuses.
2. An admin upload is parsed and aggregated by the existing validation engine before it is accepted.
3. Accepted uploads write a dataset record, upload record, and validation report to MongoDB.
4. Dashboard analytics continue to read validated source files through the backend and expose their periods through the existing overview APIs.
5. `/api/health` reports overall service health without exposing database diagnostics; `/api/health/ready` is intended for infrastructure readiness probes.

Admin login is verified server-side and issues the same protected session cookie used by admin API routes; the browser's `sessionStorage` flag is only a display convenience and does not grant access. Before production deployment, rotate any credentials that were exposed during setup.

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, or `ADMIN_SEED_PHONE` and `ADMIN_SEED_PASSWORD`, in `.env` before starting the backend to seed the first admin account. Password-reset email uses the official Resend API; set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. The sender domain must be verified in Resend before delivery can work. Emails contain a one-time link and a six-digit fallback code; both expire after 10 minutes. Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`/`OPENAI_API_URL` to enable the assistant. Weather uses Open-Meteo and requires no API key, subject to provider availability.

Weather uses Meteomatics automatically when `METEOMATICS_USER` and `METEOMATICS_PASSWORD` are configured. The request includes temperature, humidity, hourly and daily precipitation, wind, thunderstorm warnings, heavy-rain warnings, and wind warnings. Without those credentials, the service falls back to Open-Meteo.

## Weather API

Open-Meteo is the default free provider. It requires no API key and supports worldwide latitude/longitude coordinates. The service caches forecast responses for three hours and returns normalized current conditions, seven-day daily forecast, hourly provider data, configurable agriculture indicators, livestock indicators, and conservative alerts.

Examples:

```text
GET /api/weather?latitude=-1.9441&longitude=30.0619&name=Kigali&country=Rwanda
GET /api/weather/rwanda/Musanze
GET /api/weather/current?latitude=-1.9441&longitude=30.0619
GET /api/weather/forecast?latitude=-1.9441&longitude=30.0619
GET /api/farms/:farmId/weather
```

Weather routes require an authenticated user. Agriculture and livestock thresholds are configuration defaults for signals, not crop-specific scientific advice. Validate thresholds with agronomists and livestock specialists before presenting them as recommendations.

Put server-side code in this folder:

- API routes and request handlers
- Database connection and models
- Authentication and validation
- Crop-risk prediction services
- Environment configuration such as `.env`

The landing page does not need a backend yet. The frontend lives in `../frontend` and can later call API endpoints from this folder.

Suggested future structure:

```text
backend/
  src/
    server.js
    routes/
    controllers/
    services/
    models/
```
