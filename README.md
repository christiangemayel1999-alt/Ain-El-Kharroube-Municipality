# Ain El Kharroube MVP

Production-oriented MVP for managing displaced households and rental housing.

- Frontend: Angular + Angular Material + Leaflet + ng2-charts
- Backend: Node.js + Express + TypeScript + Prisma
- Database: PostgreSQL

## Security and privacy choices

- No secrets are hardcoded.
- Backend secrets are loaded from `backend/.env`.
- JWT auth + role-based access control (ADMIN, CASE_WORKER, FINANCE, VIEWER, POLICE).
- Map click coordinates are **never stored raw**.
- Backend stores only:
  - `approxLat`
  - `approxLng`
  - `pinPrecisionM` (`0` exact, `500` privacy grid)
- Dashboard supports **Pin New Family** flow from the map drawer.
- Village is divided into **Section 1..10** automatically.
  - On new family pin, backend assigns section from pin coordinates.
  - Staff do not manually choose zone for new arrivals.
- Location capture options:
  - pin directly on map
  - paste Google Maps shared link (with coordinates)
  - enter latitude/longitude manually
- Pin precision options:
  - `EXACT` (pinPrecisionM=0)
  - `GRID_500M` (privacy mode)
- Intake drawer captures:
  - household head name
  - **family** origin area (inside country, not landlord location)
  - per-person member list:
    - name, gender, age
    - relationship to household head
    - year of birth
    - ID status/type/last-4
    - disability/chronic/pregnancy-lactation flags
    - school enrollment and employment status
  - family safety check status (`PENDING` or `CHECKED_SAFE`)
  - case priority (`LOW/MEDIUM/HIGH`)
  - nationality and preferred language
  - emergency contact (name, phone, relation)
  - optional car ownership and car details (model, color, number)
  - optional contact details (phone, WhatsApp, consent) for ADMIN/CASE_WORKER
  - auto-calculated family size and age groups
- Dashboard supports an emergency protection plan:
  - enable/disable emergency overlay on the map
  - define police deployment points only
  - pick emergency coordinates directly from the map
  - when a plan is activated, all active `POLICE` users receive assignment notifications

## 1) Create database

```sql
CREATE DATABASE ain_kharroube;
```

## 2) Backend local setup (`http://localhost:4000`)

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set:
- `DATABASE_URL`
- `JWT_SECRET` (long random value)
- `FRONTEND_ORIGIN` (optional, comma-separated origins)

Then run:

```bash
npm ci
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```

Backend production build/start check:

```bash
npm ci
npm run build
npm run start
```

Health check:

```bash
curl http://localhost:4000/health
```

## 3) Frontend local setup (`http://localhost:4200`)

```bash
cd frontend
npm ci
npm start
```

Frontend production build check:

```bash
cd frontend
npm ci
npm run build
```

## 4) Runtime API config (frontend)

Frontend loads runtime config from `frontend/public/app-config.js`.

- Local dev fallback (when no runtime config is provided): `http://localhost:4000`.
- Production fallback: `https://your-render-service.onrender.com`.

For Vercel, set `API_BASE_URL` in project env vars. The build step writes `app-config.js` automatically via `prebuild`.

## 5) QA regression tests (backend API)

Run these after backend is running:

```bash
cd backend
npm run test:e2e
```

Optional env overrides:
- `E2E_BASE_URL` (default `http://localhost:4000`)
- `E2E_ADMIN_EMAIL` (default `admin@municipality.local`)
- `E2E_ADMIN_PASSWORD` (default `Christian@123`)

Frontend validator unit test:

```bash
cd frontend
npm run test:unit
```

## 6) Deploy to Render (backend)

Service type: `Web Service`

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm run start
```

Required env vars:
- `NODE_ENV=production`
- `PORT` (Render injects this automatically)
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN=8h` (or your value)
- `FRONTEND_ORIGIN=https://<your-vercel-domain>.vercel.app`

CORS defaults:
- `http://localhost:4200`
- any `https://*.vercel.app`
- plus explicit values in `FRONTEND_ORIGIN` / `CLIENT_ORIGIN`

### Prisma migration on Render

Use production-safe migrations:

```bash
npx prisma migrate deploy
```

Render pre-deploy hooks can vary by plan. If pre-deploy is unavailable, run `npx prisma migrate deploy` manually after deploy from a shell where `DATABASE_URL` is set.

## 7) Deploy to Vercel (frontend)

Project settings:
- Framework preset: `Other` (or Angular if available in your Vercel version)
- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Output directory: `dist/frontend/browser`

Set environment variable:
- `API_BASE_URL=https://<your-render-service>.onrender.com`

SPA deep-link refresh is enabled via `frontend/vercel.json` rewrite:
- `/(.*) -> /index.html`

## 8) Post-deploy verification

1. `GET https://<render-backend>/health` returns `200` with `{"status":"ok"}`.
2. Open frontend and complete login flow.
3. Create a household from dashboard map pin flow and verify:
   - save succeeds
   - marker appears on map
   - household appears in list/dashboard.

## Seed users (change passwords immediately)

- `admin@municipality.local` / `<!-- ChangeMe123! -->`
- `caseworker1@municipality.local` / `ChangeMe123!`
- `caseworker2@municipality.local` / `ChangeMe123!`
- `viewer@municipality.local` / `ChangeMe123!`
- `police1@municipality.local` / `ChangeMe123!`

## API highlights

- `POST /auth/login`
- `GET /me`
- `CRUD /users` (ADMIN)
- `CRUD /zones`
- `CRUD /households`
- `GET/PUT /households/:id/contact` (ADMIN, CASE_WORKER)
- `CRUD /housing-units`
- `CRUD /landlords`
- `CRUD /rental-agreements`
- `CRUD /incidents`
- `GET/POST/PATCH/DELETE /emergency-plans`
- `GET /emergency-plans/active`
- `GET /notifications/me` (POLICE)
- `PATCH /notifications/:id/read` (POLICE)
- `GET /dashboard/summary`
- `GET /exports/households-by-zone.csv` (ADMIN, VIEWER, CASE_WORKER)

