# Claude Code Instructions - Alveo System (Dental SaaS)

## Project Overview

**Nombre:** Dental Clinic Management System (SaaS) - Alveodent
**Versión Original:** Flutter + Dart + PocketBase
**Versión Destino:** React + Node.js + PostgreSQL (Multi-tenant SaaS)
**Fecha de Inicio:** 29 de Diciembre, 2025
**Autor:** Mike

Multi-tenant SaaS dental clinic management system migrated from Flutter to React/Node.js/PostgreSQL.

## Tech Stack

- **Frontend (`apps/app`):** React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- **Backend (`apps/api`):** Node.js 22 + Express 5 + TypeScript
- **Database (`packages/database`):** PostgreSQL + Prisma ORM
- **Shared (`packages/shared`):** Shared types and utilities
- **Monorepo:** pnpm workspaces + Turborepo

## Commands

**IMPORTANT:** Always use `pnpm`, never `npm` or `yarn`.

```bash
# Install dependencies
pnpm install

# Development (starts all apps)
pnpm dev

# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @dental/api test
pnpm --filter @dental/app test

# Watch mode tests
pnpm --filter @dental/api test:watch
pnpm --filter @dental/app test:watch

# Lint
pnpm lint

# Database commands (run from root or packages/database)
pnpm --filter @dental/database db:migrate      # Run migrations
pnpm --filter @dental/database db:generate     # Generate Prisma client
pnpm --filter @dental/database db:studio       # Open Prisma Studio
pnpm --filter @dental/database db:seed         # Seed database
pnpm --filter @dental/database db:reset        # Reset database

# Start Docker services for local development
docker compose -f docker-compose.dev.yml up -d
```

## Project Structure

```
dental-saas/
├── apps/
│   ├── api/              # Express backend (port 5001)
│   │   ├── src/
│   │   │   ├── routes/   # API route handlers
│   │   │   ├── services/ # Business logic
│   │   │   ├── middleware/
│   │   │   ├── emails/   # Email templates (React Email)
│   │   │   ├── pdfs/     # PDF templates (@react-pdf/renderer)
│   │   │   └── utils/
│   │   └── package.json
│   ├── app/              # React frontend (port 5002)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── stores/   # Zustand stores
│   │   │   ├── lib/      # API clients, utilities
│   │   │   └── i18n/     # Internationalization (ES, EN, AR)
│   │   └── package.json
│   └── web/              # Landing page (port 5003)
├── packages/
│   ├── database/         # Prisma schema and client
│   │   └── prisma/
│   │       └── schema.prisma
│   └── shared/           # Shared TypeScript types
├── CLAUDE.md             # Project setup and architecture
├── ROADMAP.md            # Full backlog and future epics
├── IN_PROGRESS.md        # Active tasks for current cycle
└── turbo.json
```

## Architecture Notes

### Multi-Tenant Design
- Row-Level Security: All queries filtered by `tenantId`
- JWT contains `tenantId` extracted by middleware
- Prisma Extension handles automatic tenant filtering

### Authentication & Authorization
- JWT-based authentication
- Roles: SUPER_ADMIN, OWNER, ADMIN, CLINIC_ADMIN, DOCTOR, STAFF
- Super admin uses separate routes (`/admin/*`)
- **RBAC (Role-Based Access Control):**
  - Granular permission system with 50+ permissions
  - Permissions: `PATIENTS_CREATE`, `LABWORKS_UPDATE`, `TENANT_DELETE`, etc.
  - Backend: `requirePermission()` middleware for route protection
  - Frontend: `usePermissions()` hook and `<Can>` component for UI
  - Permission hierarchy:
    - **STAFF:** Read-only access (view patients, appointments, labworks, expenses)
    - **DOCTOR:** STAFF + edit dental charts + view statistics
    - **CLINIC_ADMIN:** Full CRUD on operational resources (patients, appointments, doctors, labworks, expenses) but no user management, settings, or data export
    - **ADMIN:** Full CRUD on all resources including users and settings
    - **OWNER:** ADMIN + tenant profile, billing, promote to owner, delete tenant

### API Patterns
- Express 5 with async handlers
- Zod for request validation
- Service layer for business logic
- Integration tests use supertest

### Frontend Patterns
- Zustand for state management
- React Hook Form + Zod for forms
- Axios for API calls
- i18n with react-i18next (ES/EN/AR with RTL support)

## Testing

- **Framework:** Vitest
- **Backend:** Unit tests for services, integration tests for routes
- **Frontend:** React Testing Library + jsdom
- **Current count:** 495 backend + 978 frontend = 1,473 tests passing

```bash
# Run specific test file
pnpm --filter @dental/api test src/services/pdf.service.test.ts
pnpm --filter @dental/app test src/lib/pdf-api.test.ts
```

### Running the API test suite

The backend suite deletes rows, so it runs against its own database
(`dental_test`) — never the development one (`dental_saas`).

```bash
# One-time bootstrap: creates dental_test if absent + applies migrations
pnpm --filter @dental/database db:test:setup

pnpm --filter @dental/api test
```

- Connection settings come from the committed `test.env` at the repo root
  (local-only values, no secrets — the name avoids the `.env*` files that are
  deliberately kept out of version control). An already-set `DATABASE_URL` wins
  over it, which is how CI injects its own database.
- `docker-compose.dev.yml` also creates `dental_test` via
  `docker/postgres/init/01-create-test-db.sql`, but Postgres only runs init
  scripts on a **fresh** volume. On an existing volume use `db:test:setup`.
- If `DATABASE_URL` points at a database whose name does not end in `test`, the
  suite fails fast with an explanatory error. Override with
  `ALLOW_NON_TEST_DB=1` only if you accept losing that database's data.

## Environment Variables

Copy `.env.example` to `.env` and configure:

### Application Ports
- `PORT` - API server port (default: 5001)
- `VITE_APP_PORT` - App frontend port (default: 5002)
- `VITE_WEB_PORT` - Landing page port (default: 5003)

### Database & Services
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `POSTGRES_PORT` - PostgreSQL port (default: 5432)
- `REDIS_PORT` - Redis port (default: 6379)

### Authentication & Security
- `JWT_SECRET` - JWT signing secret (min 32 characters)
- `JWT_ACCESS_EXPIRES_IN` - Access token expiration (default: 15m)
- `JWT_REFRESH_EXPIRES_IN` - Refresh token expiration (default: 7d)
- `SETUP_KEY` - Super admin setup key (min 16 characters)

### External Services
- `RESEND_API_KEY` - Email service (Resend)
- `EMAIL_FROM` - Email sender address

### Other
- `NODE_ENV` - Environment (development/production/test)
- `CORS_ORIGIN` - Allowed CORS origin (cannot be "*" in production)
- `VITE_API_URL` - API URL for frontend apps

## Git Workflow

- Main branch: `main`
- Feature branches: `feat/feature-name` or `feature/feature-name`
- PRs to `main` with descriptive titles
- Commits co-authored by Claude Code

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- Spanish for user-facing strings (i18n keys)
- English for code, comments, and commits
- No emojis in code unless explicitly requested

## Quick Reference

| App | Port | Env Variable | Package Name |
|-----|------|--------------|--------------|
| API | 5001 | `PORT` | @dental/api |
| App | 5002 | `VITE_APP_PORT` | @dental/app |
| Web | 5003 | `VITE_WEB_PORT` | @dental/web |

**Note:** All ports are configurable via `.env` file.

---

## Development Status

**Current State:** Production-ready SaaS application deployed on Coolify

All core features completed (15 phases):
- Multi-tenant architecture with row-level security
- Authentication & authorization (JWT, RBAC with 6 roles)
- Patient management with dental charts (9 statuses, odontogram)
- Appointments, doctors, labworks, expenses
- Dashboard with statistics
- PDF generation & data export (multi-language)
- Internationalization (ES, EN, AR with RTL)
- Landing page & marketing site
- Welcome email for new tenants
- CI/CD pipeline & production deployment

**Test Coverage:** 1,473 passing tests (495 backend + 978 frontend)

## Security Notes

### Super Admin
- No seed file (credentials never in repo)
- SETUP_KEY required, auto-disable after first use
- Separate routes: `/admin/*` vs `/:clinicSlug/*`

### Multi-Tenant
- Row-Level Security with `WHERE tenant_id = ?`
- Middleware extracts tenantId from JWT
- Prisma Extension for automatic filtering

---

## Coolify Deployment

Application deployed and running in production.

**Guides:**
- [docs/COOLIFY-DEPLOYMENT.md](docs/COOLIFY-DEPLOYMENT.md)
- [docs/COOLIFY-TROUBLESHOOTING.md](docs/COOLIFY-TROUBLESHOOTING.md)

---

## Related Docs

- [ROADMAP.md](ROADMAP.md) - Full backlog, future epics, and business model
- [IN_PROGRESS.md](IN_PROGRESS.md) - Active tasks for current development cycle
- [HISTORY.md](HISTORY.md) - Log of completed work (task flow: ROADMAP → IN_PROGRESS → HISTORY)
- [docs/COOLIFY-DEPLOYMENT.md](docs/COOLIFY-DEPLOYMENT.md) - Deployment guide
- [docs/COOLIFY-TROUBLESHOOTING.md](docs/COOLIFY-TROUBLESHOOTING.md) - Troubleshooting guide
