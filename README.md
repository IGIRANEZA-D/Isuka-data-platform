# Isuka Agriculture Data Platform

Isuka presents public agricultural survey summaries for Rwanda, sourced from NISR Seasonal Agricultural Survey files for 2020–2025. The dashboard is served by the Express backend and uses verified aggregate artifacts; it does not expose respondent, household, or plot rows.

## Development

- `npm run dev` starts the backend and dashboard frontend.
- `npm test` runs the backend unit and integration tests.
- `npm run verify:data` validates the committed dataset artifacts and calculation versions.

## Account Email

The admin login accepts the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` (or `ADMIN_SEED_PHONE` and `ADMIN_SEED_PASSWORD`) from `backend/.env`. Password-reset mail uses the Resend API with `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; the API key must remain server-side. Emails contain a one-time reset link and six-digit fallback code; both expire after 10 minutes. In Resend, verify a domain you control and use a sender on that domain before expecting delivery. A public Gmail address is not a domain you can verify for production sending.

## Public dashboard

The dashboard is available under `/dashboard/`. Ask Isuka is an additive data request interface. See [docs/assistant.md](docs/assistant.md) for its request schema, limits, and current implementation status. Source data and metric definitions are documented in [DATA.md](DATA.md).
