# Coding Standards — Backend API

> Architecture rules, NestJS design patterns, database conventions, and code standards for the Curantis server.

---

## 1. General Principles

- **Strict TypeScript from day one**: `"strict": true`, no `any` (use `unknown` if type is genuinely indeterminate, then narrow).
- **Single Responsibility**: Controllers handle HTTP routing, serialization, and input validation via DTOs. Services contain all business logic and database interactions. Interceptors handle cross-cutting transformations.
- **Fail Closed / Secure by Default**: All routes require authentication by default (`JwtAuthGuard`). Only explicitly mark routes unauthenticated using `@Public()`.
- **Atomic Operations**: Always wrap multi-entity state transitions in `prisma.$transaction`.

---

## 2. TypeScript & Code Style

- Strict mode enabled (`tsconfig.json`).
- Avoid type casting (`as SomeType`) unless strictly validating against unknown schemas or working with external libraries.
- Prefer interfaces for data models and DTO shapes; use classes with `class-validator` decorators for request payloads.
- Explicit return types are required on all public methods in services and controllers.
- Use path aliases or `.js` extension matching ESM node resolutions (`import { ... } from './user.service.js'`).

---

## 3. NestJS Architecture & Module Organization

Each feature module must reside in `src/modules/<feature>/` and adhere to:
```
src/modules/<feature>/
├── dto/
│   ├── create-<feature>.dto.ts
│   └── update-<feature>.dto.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── <feature>.module.ts
└── <feature>.service.spec.ts
```

### Controllers
- Route definitions only. No SQL, no Prisma queries, no business rules.
- Input validation: All input parameters and request bodies MUST use typed DTOs with `class-validator` annotations.
- Swagger documentation: Decorate controllers with `@ApiTags('<feature>')`, `@ApiBearerAuth()`, and endpoints with appropriate response types.
- Inject current user context with `@CurrentUser() user: JwtPayload`.

### Services
- Contain domain business logic.
- Handle database transactions using `this.prisma.$transaction(async (tx) => { ... })`.
- Throw standard NestJS exceptions (`BadRequestException`, `NotFoundException`, `ForbiddenException`, `ConflictException`). Never throw raw strings or generic `Error`.

---

## 4. Database & Prisma Conventions

- **Never use `prisma db push` in any environment.** Always use:
  - Development: `npx prisma migrate dev --name <migration_name>`
  - Production / CI: `npx prisma migrate deploy`
- **Naming Conventions**:
  - Model names in `schema.prisma`: PascalCase (`WorkerProfile`, `BookingLog`).
  - Table mapping: Snake_case mapped with `@@map("worker_profiles")`.
  - Field names: CamelCase (`hourlyRateKobo`, `careRecipientName`).
- **Money Handling**:
  - **All monetary values must be stored as `BigInt` in Kobo** (1 NGN = 100 Kobo).
  - Never store Naira floats or perform decimal arithmetic on currency.
  - Responses automatically serialize `BigInt` to string via `BigIntSerializerInterceptor`.
- **Soft Deletes**:
  - Use `deletedAt DateTime?` on models where history retention is legally or operationally required (e.g. `User`).
- **Indices**:
  - Always add compound or single-column indices (`@@index`) for fields used in `WHERE`, `JOIN`, or `ORDER BY` operations (e.g., `[clientId, workerId, status]`).

---

## 5. Security & Authentication

1. **Tokens**:
   - Access tokens: 15-minute lifespan (`JWT_ACCESS_EXPIRY=900`), RS256 algorithm.
   - Refresh tokens: 30-day lifespan, cryptographically random 32-byte hex token. Stored as SHA-256 hash in database (`refresh_tokens.tokenHash`). Never store plaintext refresh tokens.
2. **Password Hashing**:
   - Always hash passwords using `bcrypt` with a minimum cost factor of 12 (`bcrypt.hash(password, 12)`).
3. **Account Locking**:
   - Enforce rate-limited login attempts via Redis (`login-attempts:<userId>`). Lock account for 15 minutes after 5 failed attempts.
4. **Role-Based Access Control (RBAC)**:
   - Use `@Roles(Role.HW, Role.CLIENT)` to restrict routes to specific user types.
   - Use `@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.VERIFICATION_OFFICER)` for administrative sub-roles.
5. **Webhooks**:
   - Payment webhooks must verify HMAC signatures against the raw request body before processing. Never use parsed JSON for cryptographic signature checks.

---

## 6. Redis & Caching Standards

- Key naming convention: `<namespace>:<identifier>` (e.g., `presence:<userId>`, `reset:<tokenHash>`, `login-attempts:<userId>`).
- Always set an explicit TTL (`EXPIRE` / `setex`) for cached transient data.
- Rate limiting: Use `@Throttle({ short: { limit: 10, ttl: 60000 } })` on sensitive endpoints (e.g., OTP resend, password reset).

---

## 7. BullMQ Background Queues

- Job names should be descriptive imperative verbs (e.g., `send-reset-link`, `send-admin-welcome`, `process-payout`).
- Job payloads should contain primitive identifiers (`userId`, `bookingId`) rather than large objects, allowing workers to fetch fresh database state at execution time.
- Always implement error handling and retries with exponential backoff on queue jobs.

---

## 8. Response Envelope & Error Handling

All responses follow the unified envelope:
```json
{
  "success": true,
  "data": ...,
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

Errors are intercepted by `HttpExceptionFilter` and formatted consistently:
```json
{
  "success": false,
  "error": {
    "statusCode": 400,
    "message": "Invalid credentials",
    "timestamp": "2026-09-26T05:30:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```
