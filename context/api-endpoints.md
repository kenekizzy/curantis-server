# Curantis Server — Complete API Endpoints Reference

> Authoritative reference for all REST endpoints, WebSocket events, payload contracts, authentication requirements, and role permissions exposed by the NestJS backend on `/api/v1`.

---

## 📋 Table of Contents

- [Global Conventions & Headers](#-global-conventions--headers)
- [1. Authentication Module (`/auth`)](#1-authentication-module-auth)
- [2. Users & Profile Module (`/users`)](#2-users--profile-module-users)
- [3. Caregiver Directory & Search (`/caregivers`)](#3-caregiver-directory--search-caregivers)
- [4. Worker Account & Verification (`/workers` & `/verification`)](#4-worker-account--verification-workers--verification)
- [5. Availability Module (`/availability`)](#5-availability-module-availability)
- [6. Bookings Module (`/bookings`)](#6-bookings-module-bookings)
- [7. Payments & Webhooks (`/payments`)](#7-payments--webhooks-payments)
- [8. Reviews Module (`/reviews`)](#8-reviews-module-reviews)
- [9. Incident Reports Module (`/reports`)](#9-incident-reports-module-reports)
- [10. Notifications Module (`/notifications`)](#10-notifications-module-notifications)
- [11. Chat REST Module (`/chat`)](#11-chat-rest-module-chat)
- [12. Admin Module (`/admin/*`)](#12-admin-module-admin)
- [13. WebSocket Gateway (`/chat` Namespace)](#13-websocket-gateway-chat-namespace)

---

## 🔧 Global Conventions & Headers

- **Base URL**: `http://localhost:5000/api/v1`
- **Authentication**: `Authorization: Bearer <RS256_ACCESS_TOKEN>`
- **Refresh Token**: Transmitted automatically in httpOnly cookie `refresh_token` (`SameSite=Strict`, `Path=/`)
- **Response Format**: All HTTP 200/201 responses are enveloped:
  ```json
  {
    "success": true,
    "data": <Payload>,
    "meta": { "page": 1, "limit": 20, "total": 45 }
  }
  ```
- **Currency**: All amounts are represented as strings in **Kobo** (e.g. `"1500000"` = ₦15,000.00).

---

## 1. Authentication Module (`/auth`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register client or worker (`{ email, phone, password, role }`) |
| `POST` | `/auth/login` | Public | Sign in (`{ identifier, password, role }`), returns `{ accessToken }` + sets refresh cookie |
| `POST` | `/auth/logout` | Auth | Invalidate current JWT jti and revoke refresh token cookie |
| `POST` | `/auth/refresh` | Public (Cookie) | Mint fresh access token using httpOnly refresh cookie |
| `GET` | `/auth/session` | Public (Cookie) | Consume one-time `google_handoff` cookie after Google OAuth redirect |
| `POST` | `/auth/otp/verify` | Public | Verify registration OTP code (`{ identifier, code }`) |
| `POST` | `/auth/otp/resend` | Public (Throttled) | Resend 6-digit OTP code (`{ identifier }`) |
| `POST` | `/auth/password/reset-request` | Public | Request password reset token (`{ identifier }`), queues reset link email |
| `POST` | `/auth/password/reset` | Public | Submit new password (`{ token, newPassword }`) using token from reset email |
| `GET` | `/auth/google` | Public | Redirects to Google OAuth 2.0 consent screen (accepts `?state=worker` or default client) |
| `GET` | `/auth/google/callback` | Public | Handles OAuth callback, sets `google_handoff` cookie, redirects to frontend `/login/google-callback` |

---

## 2. Users & Profile Module (`/users`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/users/me` | Auth | Get current authenticated user profile (`id`, `email`, `role`, `status`) |
| `PATCH` | `/users/me` | Auth | Update user account details (`{ phone, email }`) |
| `POST` | `/users/me/avatar` | Auth | Get signed Cloudinary upload signature for profile photo |
| `GET` | `/users/profile` | Client | Get client profile (care recipient details, emergency contact) |
| `PATCH` | `/users/profile` | Client | Update client profile (`{ fullName, state, lga, careRecipientName, emergencyName, emergencyPhone }`) |

---

## 3. Caregiver Directory & Search (`/caregivers`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/caregivers` | Public / Auth | Search & filter caregivers (`state`, `lga`, `workerType`, `serviceId`, `minRating`, `page`, `limit`) |
| `GET` | `/caregivers/:id` | Public / Auth | Detailed caregiver public profile (bio, credentials, ratings, reviews, availability) |

---

## 4. Worker Account & Verification (`/workers` & `/verification`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/workers/me` | HW / HS | Get worker profile, verification status, and ratings |
| `PATCH` | `/workers/me` | HW / HS | Update worker bio, hourly rate in Kobo, skills, and languages |
| `GET` | `/workers/earnings` | HW / HS | Get total earnings, available balance, escrow pending balance, and payout history |
| `GET` | `/workers/bank-accounts`| HW / HS | List registered bank accounts |
| `POST` | `/workers/bank-accounts`| HW / HS | Add bank account (`{ bankCode, accountNumber, accountName }`) |
| `POST` | `/verification/submit` | HW / HS | Submit identity documents for admin verification (`{ nin, idDocUrl, selfieUrl }`) |
| `GET` | `/verification/status` | HW / HS | Check status of verification request (`PENDING`, `VERIFIED`, `REJECTED`) |

---

## 5. Availability Module (`/availability`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/availability/worker/:id` | Public | Get public availability for booking calendar |
| `GET` | `/availability/slots` | HW / HS | List worker's recurring weekly availability slots |
| `POST` | `/availability/slots` | HW / HS | Create/replace recurring weekly slots (`{ dayOfWeek, startTime, endTime }[]`) |
| `GET` | `/availability/blocks` | HW / HS | List worker's blackout / vacation date ranges |
| `POST` | `/availability/blocks` | HW / HS | Add blackout block (`{ startDate, endDate, reason }`) |
| `DELETE`| `/availability/blocks/:id`| HW / HS | Remove a blackout block |

---

## 6. Bookings Module (`/bookings`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/bookings` | Client | Create a booking (`{ workerId, categoryId, scheduledStart, durationHours, careAddress, careRequirements }`) |
| `GET` | `/bookings` | Auth | List user bookings (filtered by `status`, `page`, `limit`) |
| `GET` | `/bookings/:id` | Auth | Get booking details, price breakdown, payment status, and activity logs |
| `PATCH`| `/bookings/:id/accept` | HW / HS | Worker accepts booking request |
| `PATCH`| `/bookings/:id/reject` | HW / HS | Worker declines booking request (`{ reason }`) |
| `PATCH`| `/bookings/:id/start` | HW / HS | Worker marks booking as in progress upon arrival |
| `PATCH`| `/bookings/:id/complete`| HW / HS | Worker marks booking completed, begins escrow dispute window |
| `PATCH`| `/bookings/:id/cancel` | Client/Worker| Cancel booking (`{ reason }`) |
| `POST` | `/bookings/:id/dispute` | Client/Worker| Raise a formal dispute (`{ reason, description }`) |

---

## 7. Payments & Webhooks (`/payments`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/payments/initiate` | Client | Initialize Paystack checkout for booking (`{ bookingId, gateway }`) |
| `GET` | `/payments/verify/:reference` | Client | Verify payment transaction status after checkout modal completion |
| `POST` | `/payments/payout-request` | HW / HS | Request withdrawal of available earnings balance to default bank account |
| `POST` | `/payments/webhooks/paystack` | Webhook (HMAC)| Listen to Paystack charge & transfer events |
| `POST` | `/payments/webhooks/flutterwave`| Webhook (HMAC)| Listen to Flutterwave transaction events |

---

## 8. Reviews Module (`/reviews`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/reviews` | Client | Submit a rating and review for a completed booking (`{ bookingId, rating, body }`) |
| `GET` | `/reviews/worker/:workerId` | Public | List published reviews for a specific worker |

---

## 9. Incident Reports Module (`/reports`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/reports` | Auth | Submit safety or conduct report (`{ bookingId, accusedId, category, description, imageUrls }`) |
| `GET` | `/reports/my-reports`| Auth | View reports submitted by current user |

---

## 10. Notifications Module (`/notifications`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/notifications` | Auth | List notifications for authenticated user |
| `PATCH`| `/notifications/:id/read` | Auth | Mark specific notification as read |

---

## 11. Chat REST Module (`/chat`)

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/chat/conversations` | Auth | List user's active conversations with latest message snippet |
| `GET` | `/chat/conversations/:id/messages`| Auth | Paginated message history for conversation |
| `POST` | `/chat/upload-url` | Auth | Request Cloudinary signed signature for uploading chat media |

---

## 12. Admin Module (`/admin/*`)

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/admin/auth/login` | Public | Administrator login (`{ identifier, password, role: 'ADMIN' }`) |
| `POST` | `/admin/auth/create-admin` | SUPER_ADMIN | Provision a new administrative officer account |
| `GET` | `/admin/analytics` | Admin | Aggregate dashboard KPIs (GMV, bookings, active disputes, monthly trends) |
| `GET` | `/admin/verifications` | VERIFICATION_OFFICER / SUPER_ADMIN | Verification queue (`status`, `page`, `limit`) |
| `PATCH`| `/admin/verifications/:id/review`| VERIFICATION_OFFICER / SUPER_ADMIN | Approve or reject verification (`{ status, adminNote }`) |
| `GET` | `/admin/users` | Admin | List all registered users across platform |
| `PATCH`| `/admin/users/:id/status`| SUPER_ADMIN | Suspend, reactivate, or deactivate a user account |
| `GET` | `/admin/bookings` | SUPPORT_AGENT / SUPER_ADMIN | View all bookings with filter options |
| `PATCH`| `/admin/bookings/:id/cancel`| SUPPORT_AGENT / SUPER_ADMIN | Force cancel booking with reason |
| `GET` | `/admin/payments/disputes`| FINANCE_OFFICER / SUPER_ADMIN | List open payment and booking disputes |
| `PATCH`| `/admin/payments/disputes/:id/resolve`| FINANCE_OFFICER / SUPER_ADMIN | Issue full/partial refund or release escrow |
| `GET` | `/admin/reports` | SUPPORT_AGENT / SUPER_ADMIN | Incident reports moderation queue |
| `PATCH`| `/admin/reports/:id/resolve`| SUPPORT_AGENT / SUPER_ADMIN | Resolve incident report with written outcome |
| `GET` | `/admin/reviews` | SUPPORT_AGENT / SUPER_ADMIN | Moderate reviews (remove abusive or fraudulent reviews) |

---

## 13. WebSocket Gateway (`/chat` Namespace)

The gateway is reachable at `ws://localhost:5000/chat`. Handshake requires `{ auth: { token: "<JWT_ACCESS_TOKEN>" } }`.

### Client-to-Server Events
- `chat:join` — `{ conversationId: string }`
- `chat:leave` — `{ conversationId: string }`
- `chat:send` — `{ conversationId: string, text?: string, fileUrl?: string, fileType?: string, fileName?: string }`
- `chat:typing` — `{ conversationId: string }`

### Server-to-Client Events
- `chat:message` — Emitted when a new message is posted to a room
- `chat:typing` — `{ userId: string, conversationId: string }`
- `chat:presence` — `{ userId: string, status: "online" | "offline" }`
