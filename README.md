# Usage Metering & Billing Engine

## Authentication

Real authentication (signup, sessions) is an explicit non-goal for this
project. A mock auth layer (`middleware/mockAuth.ts`) simulates the result
of authentication instead: each request sends a static `api_key` as a
Bearer token, which is resolved to a `tenant_id` before reaching any route.

## Setup & running locally

### Prerequisites
- Node.js
- Docker Desktop (running)

### 1. Clone and install
```bash
git clone <repo-url>
cd flyrank-capstone-metering-billing
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

### 3. Docker setup
```bash
npm run setup
```
This starts Postgres in Docker, runs all migrations in order, and seeds
plans + test tenants. Equivalent to running each step manually:
```bash
docker compose up -d
npm run migrate
npm run seed
```

### 4. Start the server
```bash
npm run dev
```
Server runs at `http://localhost:3000`. Confirm it's up:
```bash
curl http://localhost:3000/health
```

### 5. Run tests
```bash
npm test
```

## Resetting the database

`npm run setup` is not safely re-runnable against an existing database —
migrations will fail if the tables already exist. To fully close and reset:

```bash
docker compose down -v
```

The `-v` flag removes the Postgres data volume as well, so the next
`npm run setup` starts from a completely clean database. Running
`docker compose down` without `-v` stops the container but keeps existing
data for next time.