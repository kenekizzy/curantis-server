# Curantis — Backend API

> Progressive NestJS modular monolith powering Nigeria's trusted healthcare workforce marketplace.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Monorepo Consumers](#-monorepo-consumers)
- [Prerequisites](#-prerequisites)
- [Environment Configuration](#-environment-configuration)
- [Getting Started](#-getting-started)
- [Database & Migrations](#-database--migrations)
- [Queue & Background Jobs](#-queue--background-jobs)
- [Real-Time WebSocket Gateway](#-real-time-websocket-gateway)
- [API Documentation & Swagger](#-api-documentation--swagger)
- [Testing](#-testing)
- [Project Structure](#-project-structure)

---

## 🎯 Overview

The Curantis Backend is a high-performance, secure backend API built with **NestJS 11**, **PostgreSQL (via Prisma ORM)**, **Redis**, and **BullMQ**. It orchestrates the platform's multi-sided marketplace:
- **Clients (Patients & Families)**: Search caregivers, create bookings, escrow payments via Paystack, track care delivery, chat in real-time, leave reviews, and submit incident reports.
- **Workers (Healthcare Workers & Students)**: Set availability slots, accept bookings, verify credentials/NIN, track earnings in Kobo, and request payouts to Nigerian bank accounts.
- **Admin Staff**: Review identity verifications, resolve booking disputes, manage users, supervise payouts, and track platform KPIs.

---

## 🛠️ Architecture & Tech Stack

| Component | Technology | Description |
|---|---|---|
| **Framework** | NestJS 11 (Express) | Modular monolith with dependency injection |
| **Language** | TypeScript 5.7+ | Strict mode enabled |
| **Database** | PostgreSQL 16 (Neon / Local) | Relational store with foreign key integrity |
| **ORM** | Prisma 6 | Type-safe queries, migrations, and schema definition |
| **Caching & Presence** | Redis 7+ (Upstash / Local) | Rate limiting, user presence, session cache, password reset tokens |
| **Job Queue** | BullMQ + Redis | Background workers for emails, push notifications, and payouts |
| **Real-time** | Socket.io 4 (`@nestjs/websockets`) | WebSocket gateway on `/chat` namespace |
| **Authentication** | Passport.js + `@nestjs/jwt` | Asymmetric RS256 JWT (15-min access) + rotating refresh token cookies (30 days) |
| **Payments** | Paystack & Flutterwave | Escrow payment initialization and HMAC-verified webhook listeners |
| **Media Storage** | Cloudinary | Signed direct-to-cloud file uploads for ID cards, selfies, and chat attachments |
| **Logging** | `nestjs-pino` + `pino-pretty` | Structured JSON logging in production, pretty output in development |

---

## 🌐 Monorepo Consumers

The server listens on **port 5000** (`http://localhost:5000`) with global prefix `/api/v1` and handles CORS for:

| Consumer | Port | URL | Purpose |
|---|---|---|---|
| **Client Portal** | `3000` | `http://localhost:3000` | Patient / family booking portal |
| **Health Worker Portal** | `3001` | `http://localhost:3001` | Worker job feed & calendar |
| **Admin Dashboard** | `4200` | `http://localhost:4200` | Internal operations & dispute resolution |

---

## ⚙️ Environment Configuration

Create a `.env` file in the `server` root directory:

```env
# App Configuration
NODE_ENV=development
PORT=5000
APP_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000
WORKER_URL=http://localhost:3001
ADMIN_URL=http://localhost:4200

# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:password@localhost:5432/curantis?schema=public"
DIRECT_URL="postgresql://postgres:password@localhost:5432/curantis?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT RS256 Keys (generate with OpenSSL)
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
JWT_ACCESS_EXPIRY=900        # 15 minutes in seconds
JWT_REFRESH_EXPIRY=2592000    # 30 days in seconds

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_CALLBACK_URL="http://localhost:5000/api/v1/auth/google/callback"

# Payments (Paystack & Flutterwave)
PAYSTACK_SECRET_KEY="sk_test_xxx"
FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-xxx"

# Cloudinary (File & Media Storage)
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# Email Delivery (Resend)
RESEND_API_KEY="re_xxx"
EMAIL_FROM="Curantis <noreply@curantis.ng>"
```

---

## 🚀 Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Ensure PostgreSQL and Redis are running:**
   ```bash
   # If using Docker:
   docker run --name curantis-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=curantis -p 5432:5432 -d postgres:16-alpine
   docker run --name curantis-redis -p 6379:6379 -d redis:7-alpine
   ```

3. **Run Database Migrations & Seed Data:**
   ```bash
   npx prisma migrate dev
   npx prisma db seed
   ```

4. **Start the Development Server:**
   ```bash
   npm run start:dev
   ```
   The API will be available at `http://localhost:5000/api/v1`.

---

## 🗄️ Database & Migrations

All models use **Prisma ORM**. Financial values are strictly stored as `BigInt` in **Kobo** (1 Naira = 100 Kobo) to prevent floating-point rounding errors.

- **Apply migrations in development**:
  ```bash
  npx prisma migrate dev --name <migration_name>
  ```
- **Apply migrations in production**:
  ```bash
  npx prisma migrate deploy
  ```
- **Generate Prisma Client**:
  ```bash
  npx prisma generate
  ```
- **Open Prisma Studio (visual database browser)**:
  ```bash
  npx prisma studio
  ```

---

## 📬 Queue & Background Jobs

BullMQ handles asynchronous workloads through dedicated processors:
- **`notifications`**: Dispatches transactional emails (via Resend) and SMS notifications.
- **`payouts`**: Asynchronously processes worker withdrawal requests and escrow releases.
- **Cron Jobs**: Escrow release checks (releasing funds to workers after booking completion windows).

---

## 💬 Real-Time WebSocket Gateway

The WebSocket gateway is mounted on namespace `/chat` (`http://localhost:5000/chat`):
- **Handshake Authentication**: Clients must provide the RS256 JWT in `handshake.auth.token`.
- **Events Supported**:
  - `chat:join`: Join a conversation room (`{ conversationId }`).
  - `chat:leave`: Leave a conversation room (`{ conversationId }`).
  - `chat:send`: Send a message (`{ conversationId, text, fileUrl, fileType, fileName }`).
  - `chat:typing`: Broadcast typing status (`{ conversationId }`).
  - `chat:message`: Server broadcast of incoming message to conversation participants.
  - `chat:presence`: Redis-backed online/offline presence tracking.

---

## 📖 API Documentation & Swagger

When running in non-production mode, Swagger OpenAPI documentation is available at:
👉 **`http://localhost:5000/api/docs`**

---

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run end-to-end tests
npm run test:e2e

# Generate test coverage report
npm run test:cov
```

---

## 📂 Project Structure

```
server/
├── prisma/
│   ├── schema.prisma         # Prisma data schema & enums
│   └── seed.ts               # Database seeder (service categories, admin, demo users)
├── src/
│   ├── app.module.ts         # Root module with global guards & throttler
│   ├── main.ts               # Application entry point, global pipes & filters
│   ├── common/               # Decorators, filters, guards, interceptors, types
│   ├── infrastructure/       # External service adapters
│   │   ├── prisma/           # Prisma service singleton
│   │   ├── redis/            # Redis service singleton
│   │   ├── socket/           # WebSocket gateway (/chat namespace)
│   │   └── storage/          # Cloudinary signed upload provider
│   └── modules/              # Domain-driven feature modules
│       ├── admin/            # Admin operations (verifications, users, disputes, payouts)
│       ├── auth/             # Authentication (JWT RS256, Google OAuth, OTP, password reset)
│       ├── availability/     # Worker weekly slots and blackout blocks
│       ├── bookings/         # Booking state machine and logs
│       ├── chat/             # Conversations & messages REST controller
│       ├── mail/             # Resend email templates & dispatcher
│       ├── notifications/    # In-app notifications
│       ├── payments/         # Paystack & Flutterwave integration, webhooks
│       ├── profiles/         # Client profile management
│       ├── reports/          # Incident reporting & moderation
│       ├── reviews/          # Review submission & rating recalculation
│       ├── users/            # User identity, avatar upload
│       ├── verification/     # Worker identity document verification
│       └── workers/          # Worker directory search & public caregiver profiles
├── context/                  # LLM architecture & feature context documents
└── test/                     # Jest e2e test suites
```
