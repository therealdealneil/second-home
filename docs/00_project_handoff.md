# Project Handoff & Implementation Guide (Gujarat → San Antonio V1)

## 1. Executive Summary of Strategy & Decisions
We are building a **dual-location community discovery app** that connects immigrants and diaspora families who are simultaneously **neighbors in their new city** and **former neighbors in their hometown/origin region**.

### Key Strategic Decisions
1. **Hyper-Focused Launch Corridor (`Gujarat, India → Greater San Antonio, TX`):**
   - To solve the two-sided density ("cold-start") problem, V1 is strictly scoped to connecting Gujarati individuals and families living in Greater San Antonio (e.g., Northwest/Medical Center, Stone Oak, Alamo Ranch, Boerne, Schertz/New Braunfels) based on their specific origin cities/districts/neighborhoods in Gujarat (e.g., Ahmedabad, Vadodara, Surat, Anand/Charotar, Rajkot).
2. **Split Funnel ("Browse on Web, Claim Pin on Mobile"):**
   - **Web App (Next.js):** Read-only viral discovery map displaying aggregated Uber H3 hexagonal heatmaps (`>= 2` households per hex for k-anonymity). Desktop visitors scan a QR code to claim their pin on mobile.
   - **Mobile App (React Native / Expo):** Required for registration and pin creation so we can enforce hardware-backed GPS fixes and cryptographic device attestation (**Apple App Attest** / **Google Play Integrity**), preventing desktop bot farms and VPN spoofing.
3. **30-Second "Reverse Onboarding":**
   - Users open the mobile app straight to the map, confirm their San Antonio neighborhood via GPS, select their Gujarat hometown via instant autocomplete, and preview blurred local matches *before* creating an account.
4. **Household Grouping & Age/Life-Stage Matching:**
   - Family members at the same residence share a single **Household Pin** (preventing address triangulation from overlapping family pins) while indexing *all* household members' Gujarat origins so spouses from different cities both match neighbors.
   - 1-tap **Age Bracket** (`20s`–`60+`) and **Life Stage** (`Solo`, `Couple`, `Young Kids`, `Teens`, `Seniors`) pills replace birthdates and forms.
5. **Zero-Inbox Messaging (WhatsApp Handoff):**
   - No in-app chat engine. Upon mutual connection acceptance, both users unlock a `wa.me` deep link with a pre-filled greeting to move conversations directly into WhatsApp.
6. **Privacy-First Monetization & Compliance:**
   - Raw coordinates (`exact_current_geog`) and phone numbers (`phone_e164`) are locked down via PostgreSQL Row-Level Security (RLS) and never sold to data brokers. Future monetization focuses on hyper-local B2B sponsorships (groceries, restaurants, cultural events) and newcomer affiliate services.

---

## 2. Recommended Tech Stack & Monorepo Layout
Initialize a **Turborepo** TypeScript monorepo with the following structure:

```text
/
├── docs/                           # Place 01 through 04 spec files here
│   ├── 01-user-flows.md
│   ├── 02-mvp-feature-matrix.md
│   ├── 03-data-and-privacy-schema.md
│   └── 04-anti-abuse-and-trust.md
├── apps/
│   ├── mobile/                     # Expo (React Native + TypeScript + Expo Router)
│   └── web/                        # Next.js (App Router + Tailwind CSS)
├── packages/
│   └── shared/                     # Shared TS types, Zod schemas, Gujarat gazetteer JSON, H3 helpers
└── supabase/
    ├── migrations/                 # PostgreSQL + PostGIS schema & RPCs (from 03-data-and-privacy-schema.md)
    └── functions/                  # Edge Functions (auth-challenge, verify-attestation, create-household)
```

### Core Services
- **Database & Auth:** Supabase (PostgreSQL 17 + PostGIS + Auth with Apple, Google, and SMS OTP).
- **Maps & Spatial:** Mapbox GL (mobile & web vector tiles) + Uber `h3-js` (resolution-7 hex binning).
- **Rate Limiting & Nonces:** Upstash Redis (sliding-window rate limits + 60-second attestation challenges).
- **Hosting:** Vercel (Next.js web preview) + EAS Build (Expo iOS/Android).

---

## 3. Instructions for Antigravity (Execution Sequence)

Please execute the build in the following order, strictly adhering to the rules in `docs/01` through `docs/04`:

### Step 1: Scaffold Monorepo & Database Migration
1. Initialize the Turborepo structure (`apps/mobile`, `apps/web`, `packages/shared`, `supabase/`).
2. Create the initial Supabase SQL migration from `docs/03-data-and-privacy-schema.md`, including:
   - PostGIS extension, custom enums, `households`, `users`, `connections`, and `hometown_vouches` tables.
   - `find_matching_households` and `get_whatsapp_handoff_link` RPC functions.
   - Strict column-level `REVOKE SELECT` rules on `exact_current_geog` and `phone_e164`, plus `web_h3_density_view`.
3. Generate `packages/shared/src/data/gujarat-locations.json` containing all **33 districts of Gujarat**, major cities, talukas, and major urban neighborhoods (Ahmedabad, Vadodara, Surat, Rajkot, Anand/Nadiad, Gandhinagar, Bhavnagar, Jamnagar, Junagadh, Mehsana, etc.) with accurate `(lat, lng)` coordinates for offline/instant autocomplete.

### Step 2: Build the Interactive Mobile Prototype (Mock Data First)
1. Implement **Flow B (Reverse Onboarding)** in `apps/mobile`:
   - Full-screen Mapbox map on launch.
   - San Antonio neighborhood GPS capture with a visual **0.5–1.5 mile privacy fuzzing circle** and Greater San Antonio geofence check.
   - Instant Gujarat hometown autocomplete selector.
   - Blurred match preview screen with **Dynamic Zoom Fallback** (widening to all of Gujarat if exact hometown matches < 3).
   - 1-tap Apple/Google Sign-In + SMS OTP modal, followed by 1-tap **Age Bracket** & **Life Stage** pills and **"Invite Spouse / Family"** WhatsApp share trigger.
2. Implement **Flow C (Discovery & Household Drawer)**:
   - Render grouped **Household Pins** with stacked avatars and filters (`Exact Town vs. All Gujarat`, `Radius`, `Age Bracket`, `Life Stage`).
   - Household bottom sheet showing all linked members, trust badges (`Verified Local`, `Vouched by Neighbors`), 1-tap icebreakers, and WhatsApp handoff (`wa.me`) upon acceptance.
   - *RPC note for multi-origin households:* In `find_matching_households` (Step 1), filtering `u.hometown_geog` in the `WHERE` clause before `JSONB_AGG` returns only the member(s) matching the searched hometown (e.g., searching Ahmedabad returns only the Ahmedabad spouse of a mixed Ahmedabad/Vadodara household). To show **all** linked active members in the Household Bottom Sheet once a household matches, add a follow-up migration in Step 2 using an `EXISTS` subquery for the hometown/age filter and aggregating all active members of the matched household.

### Step 3: Implement Edge Security, Attestation & Backend APIs (`docs/04`)
1. Build Supabase Edge Functions for:
   - `GET /auth-challenge`: Issues single-use 60-second nonces in Upstash Redis.
   - `POST /create-household` & `POST /join-household`: Verifies Apple App Attest / Google Play Integrity tokens, rejects mock GPS flags, validates the Greater San Antonio bounding polygon, validates coordinate precision (`accuracy_meters`) & Impossible Travel (`>600 mph` vs. `last_verified_at`), computes a **one-time static 0.5–1.5 mile offset** for `public_current_geog`, computes `h3_index_res7`, and enforces the 25-mile proximity check when joining an existing household via `invite_code`.
   - `POST /send-connection-request`: Verifies device attestation + single-use 60s nonce, enforces outbound request rate limits (`10/24h` new accounts, `25/24h` `Verified Local`), and filters URLs/phone numbers in icebreakers.
2. Add Upstash Redis sliding-window rate limits for Map Pan/Query (`30 req/min` authenticated, `10 req/min` anon web) and SMS OTP sends (`3/hr` per phone and device attestation ID).
3. Add backend tables, RPCs, and triggers for:
   - `user_reports` table and auto-quarantine trigger (`>= 3` reports from `Verified Local` users).
   - Pre-auth blurred preview access (Supabase Anonymous Auth or a rate-limited aggregate-only preview endpoint returning counts and fuzzed centers without member profiles).
   - Server-backed social/trust mutations: connection acceptance/decline, 1-tap block (`connections.status = 'blocked'`), Ghost Mode (`users.status = 'paused'`), `hometown_vouches` (enforcing the 48-hour post-acceptance gate), `Verified Local` / `Hometown Visit` GPS heartbeat verification, and `waitlist_signups` (`F-17`).

### Step 4: Build the Web Viral Preview App (`apps/web`)
1. Build a fast, SEO-friendly Next.js map page querying `web_h3_density_view`.
2. Allow visitors to pick a Gujarat hometown/district and explore San Antonio H3 hex clusters.
3. Render a dynamic QR code encoding `?origin_id=<location_id>` that deep-links desktop visitors into the mobile app.
4. Serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on `secondhome.app` so Universal Links and Android App Links (`autoVerify: true`) launch the native app directly.

### Step 5: Wire Live Mobile Client, Alerts & Production Launch Readiness
1. **Supabase Client & Real Auth (`apps/mobile`):** Install `@supabase/supabase-js` and `expo-secure-store`, replace `completeMockAuth()` / demo `"123456"` OTP with real Apple/Google Sign-In + SMS OTP (`users.phone_e164`), sync `onAuthStateChange` sessions, and add sign-out + in-app **Delete Account** flow (App Store compliance).
2. **Live Discovery & Social Loops:** Replace local mock fixtures (`mockHouseholds.ts`, `MOCK_MEMBER_PHONES_E164`, `AsyncStorage`-only social state) with live `find_matching_households`, `get_whatsapp_handoff_link`, real `users`/`households` profile & `invite_code` persistence, an incoming connection requests UI (Accept/Decline), live block/vouch/report/Ghost Mode/waitlist mutations, and forwarding `position.coords.accuracy` from `useSanAntonioLocation`.
3. **Notifications & Growth Alerts (`F-14`):** Wire `expo-notifications` and device push-token registration for connection requests/acceptances, plus opt-in WhatsApp Business API match alerts (`F-14`).
4. **Production Hardening & Release Compliance:** Remove or gate prototype scaffolds (`SEEDED_CONNECTIONS`, `Simulate Mutual Accept`, `Fill Demo (123456)`, `DEV GPS`, `resetPrototypeFlow`), add error telemetry and loading/retry/offline states, configure `eas.json` release profiles and restricted Mapbox tokens, add Privacy Policy / Terms of Service / SMS OTP consent disclosures, and run live Supabase integration tests verifying RLS column locks (`exact_current_geog`, `phone_e164`).

---

## 4. Critical Guardrails (Do Not Violate)
- **NEVER** return `exact_current_geog` or `phone_e164` in any general query or client-accessible table view.
- **NEVER** dynamically re-randomize `public_current_geog` on read (must be static per household to prevent triangulation).
- **NEVER** allow desktop web users to register accounts or create pins.
- **NEVER** build an in-app chat messaging UI; always hand off accepted connections via `get_whatsapp_handoff_link`.