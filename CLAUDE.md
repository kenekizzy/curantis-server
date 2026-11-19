# Curantis Server — Claude & AI Assistant Guide

This is the backend API service for **Curantis**, a platform that connects families with verified healthcare workers (`HW`) and healthcare students (`HS`) in Nigeria, supervised by administrative officers.

---

## 🧭 Context Files

Read these files in `context/` for domain architecture and specifications:

- `@context/project-overview.md` — Complete backend architecture, tech stack, and module designs
- `@context/coding-standards.md` — NestJS, TypeScript, Prisma, and BullMQ standards
- `@context/api-endpoints.md` — Comprehensive REST API endpoint reference and query specifications
- `@context/overall-project-structure.md` — Monorepo-wide domain models, user journeys, and data schemas
- `@context/current-feature.md` — Currently active feature roadmap and completion logs

---

## ⚙️ Development Commands

```bash
# Development server (starts on http://localhost:5000 with --watch)
npm run start:dev

# Build TypeScript production bundle to dist/
npm run build

# Run production build
npm run start:prod

# Lint and auto-fix code style
npm run lint

# Format code with Prettier
npm run format

# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run end-to-end tests
npm run test:e2e

# Generate coverage
npm run test:cov
```

### Prisma ORM Commands

```bash
# Run local migrations and apply schema changes
npx prisma migrate dev --name <migration_name>

# Deploy migrations to production / staging
npx prisma migrate deploy

# Seed initial database (categories, super admin, demo records)
npx prisma db seed

# Regenerate Prisma Client types
npx prisma generate

# Launch interactive database GUI on http://localhost:5555
npx prisma studio
```

---

## 🏛️ Core Architecture & Conventions

1. **Global Prefix**: All HTTP routes are prefixed with `/api/v1` (except Swagger at `/api/docs`).
2. **Response Envelope**: Every successful response is enveloped by `ResponseTransformInterceptor`:
   ```json
   {
     "success": true,
     "data": <Payload>,
     "meta": { "total": 10, "page": 1, "limit": 20 }
   }
   ```
3. **Money Handling**:
   - Currency is Nigerian Naira (NGN).
   - **All amounts are stored and computed in Kobo (₦1 = 100 Kobo)** as `BigInt` in PostgreSQL.
   - `BigIntSerializerInterceptor` automatically serializes `BigInt` values to strings in HTTP responses.
   - Never use floating-point numbers for money calculations.
4. **Authentication & Authorization**:
   - **Access Token**: Asymmetric RS256 JWT valid for 15 minutes, passed in `Authorization: Bearer <token>`.
   - **Refresh Token**: Stored as SHA-256 hash in PostgreSQL `refresh_tokens`, sent via httpOnly `refresh_token` cookie.
   - **Global Guards**: `JwtAuthGuard`, `RolesGuard`, and `AdminRolesGuard` are globally active.
   - **Public Endpoints**: Must be decorated with `@Public()`.
   - **Current User**: Injected via `@CurrentUser() user: JwtPayload`.
5. **Real-Time WebSocket**:
   - Gateway mounted on namespace `/chat` (`http://localhost:5000/chat`).
   - Authenticated during handshake via `client.handshake.auth.token`.
6. **Payment Webhooks**:
   - Route `/api/v1/payments/webhooks` uses `express.raw({ type: 'application/json' })` for HMAC signature validation.
   - Handled directly in `PaystackWebhook` and `FlutterwaveWebhook`.
7. **Role Hierarchy**:
   - `Role`: `CLIENT`, `HW` (Licensed Worker), `HS` (Student - restricted categories only), `ADMIN`.
   - `AdminRole`: `SUPER_ADMIN`, `VERIFICATION_OFFICER`, `SUPPORT_AGENT`, `FINANCE_OFFICER`.