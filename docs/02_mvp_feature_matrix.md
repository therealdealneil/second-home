# 02 — MVP Feature Matrix (Gujarat → San Antonio V1)

## 1. Launch Scope & Non-Goals
- **Target Geography:** Greater San Antonio, TX (Destination) ↔ State of Gujarat, India (Origin).
- **Success Metric (North Star):** Percentage of registered users who complete at least **1 mutual connection + WhatsApp handoff** within 14 days of signup.
- **Explicit V1 Non-Goals (Out of Scope):**
  - In-app real-time messaging / chat inbox
  - Algorithmic social feed, status posts, or photo galleries
  - Desktop web account registration or pin creation
  - Direct user-data resale or third-party ad networks
  - Global multi-country expansion outside the Gujarat → San Antonio corridor

---

## 2. Prioritized Feature Matrix

| ID | Feature Area | Requirement Description | Priority | Platform |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | **Dual-Radius Spatial Engine** | PostGIS query (`find_matching_households`) intersecting `ST_DWithin(current_loc, r1)` AND `ST_DWithin(hometown_loc, r2)` across grouped households with sub-50ms response times. | **P0** | Backend |
| **F-02** | **Privacy Fuzzing & H3 Binning** | Store `exact_current_geog` behind strict Postgres RLS; generate a static random offset (`0.5–1.5 mi`) for `public_current_geog` and aggregate counts into Uber H3 hexagons (`k >= 2`) for web. | **P0** | Backend |
| **F-03** | **Reverse-Onboarding Map** | Open mobile app directly to interactive map; allow 2-pin placement (San Antonio GPS + Gujarat autocomplete) and blurred match preview before login. | **P0** | Mobile |
| **F-04** | **Gujarat Location Autocomplete** | Curated, fast-search gazetteer covering all 33 Gujarat districts, major cities, talukas, and prominent neighborhoods/areas so small towns resolve cleanly. | **P0** | Mobile + Web |
| **F-05** | **1-Tap Auth & Phone Capture** | Apple Sign-In + Google Sign-In paired with SMS OTP verification (required to enable WhatsApp handoffs and prevent multi-account spam). | **P0** | Mobile |
| **F-06** | **Device Integrity & Anti-Spoof** | Enforce Apple App Attest (iOS) and Google Play Integrity (Android) on pin creation; reject mock-GPS providers and non-San Antonio coordinates at launch. | **P0** | Mobile + Backend |
| **F-07** | **Age-Bracket & Life-Stage Filtering** | 1-tap pill selectors (`20s`–`60+`, `Solo`, `Couple`, `Young Kids`, `Teens`, `Seniors`) with map filter support so families and peers find similar life stages. | **P0** | Mobile + Backend |
| **F-08** | **Connection & WhatsApp Handoff** | Send/accept connection requests with 1-tap Gujarati/English icebreakers; unlock `wa.me` deep link upon mutual acceptance. | **P0** | Mobile |
| **F-09** | **Safety, Block & Report** | Instant 1-tap block/report user, ability to pause/hide pin ("Ghost Mode"), and automatic quarantine when `>= 3` `Verified Local` users report an account. | **P0** | Mobile + Backend |
| **F-10** | **Web Viral Preview & QR Handoff** | Read-only Next.js map showing H3 hexagon density counts for Gujarat → San Antonio, generating a deep-linked QR code to complete setup on mobile. | **P0** | Web |
| **F-11** | **Household Grouping & Shared Pin** | Link multiple verified accounts at the same San Antonio residence into a single stacked map pin, aggregating all members' Gujarat origins into one searchable household entity. | **P1** | Mobile + Backend |
| **F-12** | **Dynamic Zoom Fallback** | Automatically widen search from *Exact Gujarat Hometown* to *All Gujarat* (or expand San Antonio radius from 5 mi → 20 mi) when match count is `< 3`. | **P1** | Mobile |
| **F-13** | **Progressive Trust Badges** | Award **Verified Local** (after 7 days of consistent San Antonio GPS presence) and **Vouched by Neighbors** (peer confirmation 48h after connecting). | **P1** | Mobile + Backend |
| **F-14** | **WhatsApp Match Alerts** | Opt-in WhatsApp Business API notification when a new neighbor from the user's exact Gujarat hometown joins within 10 miles in San Antonio. | **P1** | Backend |
| **F-15** | **Viral "Hometown Card" Share** | Generate an image share card (*"12 households from Surat are near me in San Antonio"*) optimized for 1-tap sharing to WhatsApp Status and groups. | **P1** | Mobile |
| **F-16** | **"Taste of Home" Community Pins** | Allow verified users to pin trusted local spots in San Antonio (e.g., Gujarati grocery stores, temples, Garba venues, doctors) to boost single-player utility. | **P2** | Mobile + Web |
| **F-17** | **Metro Expansion Waitlist** | Capture email/phone + city when users outside San Antonio download the app, allowing data-driven selection of Corridor #2 (e.g., Austin, DFW, or Houston). | **P2** | Mobile + Web |
| **F-18** | **Corridor Flip (San Antonio ⇄ Gujarat)** | Discovery-phase map toggle that flies the camera between San Antonio and Gujarat, projecting matched San Antonio neighbors onto their public Gujarat hometown coordinates (including multi-origin household split pins and deterministic co-located spread). | **P1** | Mobile + Backend |

---

## 3. Definition of Done for V1 Launch (Alpha/Beta)
1. A new user in San Antonio can download the app, confirm their neighborhood via GPS, select their Gujarat hometown, sign in, pick age/life-stage pills, and view fuzzed nearby matches in **under 30 seconds**.
2. Raw exact GPS coordinates and phone numbers are never transmitted in general API payloads (`exact_current_geog` and `phone_e164` verified inaccessible via client JWT).
3. Simulated bot requests lacking valid App Attest / Play Integrity tokens are rejected at the Edge gateway with `403 Forbidden`.
4. Spouses/family members in the same residence can link via `invite_code` into a single shared map pin while matching neighbors from either member's Gujarat hometown.
5. Two test users in San Antonio with matching Gujarat hometowns can connect and launch a pre-filled WhatsApp chat in **2 taps**.