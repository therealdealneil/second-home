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
- **Database & Auth:** Supabase (PostgreSQL 16 + PostGIS + Auth with Apple, Google, and SMS OTP).
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

### Step 3: Implement Edge Security & Attestation (`docs/04`)
1. Build Supabase Edge Functions for:
   - `GET /auth-challenge`: Issues single-use 60-second nonces in Upstash Redis.
   - `POST /create-household` & `POST /join-household`: Verifies Apple App Attest / Google Play Integrity tokens, rejects mock GPS flags, validates the Greater San Antonio bounding polygon, computes a **one-time static 0.5–1.5 mile offset** for `public_current_geog`, computes `h3_index_res7`, and enforces the 25-mile proximity check when joining an existing household via `invite_code`.
2. Add the `user_reports` table and auto-quarantine trigger (`>= 3` reports from `Verified Local` users).

### Step 4: Build the Web Viral Preview App (`apps/web`)
1. Build a fast, SEO-friendly Next.js map page querying `web_h3_density_view`.
2. Allow visitors to pick a Gujarat hometown/district and explore San Antonio H3 hex clusters.
3. Render a dynamic QR code encoding `?origin_id=<location_id>` that deep-links desktop visitors into the mobile app.

---

## 4. Critical Guardrails (Do Not Violate)
- **NEVER** return `exact_current_geog` or `phone_e164` in any general query or client-accessible table view.
- **NEVER** dynamically re-randomize `public_current_geog` on read (must be static per household to prevent triangulation).
- **NEVER** allow desktop web users to register accounts or create pins.
- **NEVER** build an in-app chat messaging UI; always hand off accepted connections via `get_whatsapp_handoff_link`.