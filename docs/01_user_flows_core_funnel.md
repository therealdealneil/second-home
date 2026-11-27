# 01 — User Flows & Core Funnel (Gujarat → San Antonio V1)

## 1. Design Principles
- **30-Second Time-to-Value:** Users see nearby matches on the map *before* creating an account.
- **Zero-Keyboard Onboarding (Where Possible):** Rely on hardware GPS for San Antonio, smart autocomplete for Gujarat cities/talukas/neighborhoods, and 1-tap pills for age bracket and life stage.
- **Privacy by Default:** Exact residential coordinates are never rendered on the client; all family members at one home share a single static fuzzed pin (`0.5–1.5 mile` radius) or aggregated H3 hexagon.
- **Zero-Inbox Handoff:** Accepted connections move straight to WhatsApp (`wa.me` deep links) rather than an in-app chat system.

---

## 2. Flow A: Web Viral Preview Flow (Desktop & Mobile Browser)
*Goal: Convert clicks from WhatsApp community groups, Facebook posts, or flyers into mobile app installs without hitting an immediate login wall.*

1. **Landing (`/`):**
   - Visitor opens a shared link (e.g., *"See how many Gujaratis from your hometown live in your San Antonio neighborhood"*).
   - Opens directly to an interactive split-map or dual-selector widget—no marketing splash page required.
2. **Dual-Location Selection:**
   - **Step 1 (Destination):** Defaults to **San Antonio, TX** (allows panning/zooming across neighborhoods like Stone Oak, Medical Center, Leon Valley, Alamo Ranch).
   - **Step 2 (Origin):** Smart search bar scoped to **Gujarat, India** (supports all 33 districts, cities, talukas, and major neighborhoods—e.g., *Ahmedabad - Navrangpura*, *Vadodara - Alkapuri*, *Surat - Vesu*, *Anand*, *Rajkot*).
3. **Aggregated Heatmap Payoff:**
   - Map renders **Uber H3 hexagonal clusters** across San Antonio showing density counts (e.g., *"9 households from Vadodara live near Stone Oak"*).
   - Individual names, exact pins, and cells with `< 2` households remain hidden on the web.
4. **Mobile Handoff ("Claim Your Pin"):**
   - User taps **"See Who's Near Me"** or **"Add My Pin."**
   - **On Desktop:** Displays a dynamic QR code encoding their selected Gujarat hometown (`?origin_id=...`). Scanning launches the mobile app (or App Store/Play Store via deferred deep link) with their hometown pre-populated.
   - **On Mobile Web:** Triggers a Universal Link / App Link directly into the native app.

---

## 3. Flow B: Mobile Reverse-Onboarding Flow (iOS & Android)
*Goal: Authenticate device integrity, capture genuine GPS presence in San Antonio, and unlock blurred matches in under 30 seconds.*

1. **App Launch & Silent Integrity Check:**
   - App opens straight to the map view.
   - In the background, the client requests a cryptographic attestation token (**Apple App Attest** / **Google Play Integrity**) and checks for mock-GPS flags.
2. **Pin 1: Current Neighborhood (San Antonio):**
   - Prompts: *"Confirm your neighborhood in San Antonio."*
   - Requests foreground location permission -> captures hardware GPS fix -> displays a fuzzed ~1-mile privacy ring -> user taps **"Confirm Neighborhood"** (allows slight drag adjustment within their local area).
   - *Guardrail:* If GPS places the user outside the Greater San Antonio metro area (e.g., spoofing from overseas), prompt: *"We're currently live in San Antonio! Join the waitlist for your city."*
3. **Pin 2: Home Roots (Gujarat):**
   - Prompts: *"Where in Gujarat is home?"*
   - Autocomplete search returns standardized Gujarat districts, cities, talukas, and prominent neighborhoods. User selects their pin in 1 tap.
4. **Blurred Match Preview (The Hook):**
   - Map immediately zooms to their San Antonio radius and displays blurred household avatar pins:
     - *"14 households from [Ahmedabad] live within 10 miles of you (3 within 2 miles)."*
   - *Empty-State Fallback (Dynamic Zoom):* If fewer than 3 matches exist for their exact town within 10 miles, automatically expand the origin match to **All of Gujarat** within 15 miles so the map never feels empty.
5. **1-Tap Account Creation & Life-Stage Pills (Soft Wall):**
   - Tapping any blurred pin or **"Unlock Neighbors"** triggers 1-tap authentication:
     - **Sign in with Apple** or **Sign in with Google** (auto-fills First Name + Avatar).
     - **SMS OTP Phone Verification** (required so `wa.me` handoffs work seamlessly and bot accounts are rate-limited).
   - **3-Second Personalization (1-Tap Pills, Skippable):**
     - **Age Bracket:** `20s` • `30s` • `40s` • `50s` • `60+`
     - **Life Stage:** `Student / Solo` • `Couple` • `Family with Young Kids` • `Family with Teens` • `Seniors / Multi-Gen`
     - **Interests (up to 3):** *Cricket, Garba / Cultural Events, Food & Chai, Tech / Healthcare, Parenting*
   - **Household Invite Prompt:**
     - Confirmation screen offers a 1-tap **"Add Spouse / Family in Your Home"** button that sends a WhatsApp invite link (`.../join-household?code=...`). Linked family members share the same San Antonio pin while adding their own Gujarat hometown to the household's searchable origins.
   - Account exits silent quarantine once attestation + auth succeed, making the household's fuzzed pin visible to nearby neighbors.

---

## 4. Flow C: Discovery, Household Drawer & WhatsApp Handoff
*Goal: Turn a map pin into a trusted, real-world introduction.*

1. **Map Exploration & Filtering:**
   - User views fuzzed **Household Pins** (rendered with stacked avatars when multiple family members are linked) in their San Antonio radius.
   - Toggle filters:
     - **Origin Match:** *Exact Town/City* vs. *All Gujarat*
     - **San Antonio Radius:** *2 mi / 5 mi / 10 mi / 25 mi*
     - **Age Bracket:** *20s / 30s / 40s / 50s / 60+*
     - **Life Stage:** *Solo / Couple / Young Kids / Teens / Seniors*
2. **Pin Inspection (Household Bottom Sheet):**
   - Tapping a pin opens a bottom sheet displaying:
     - Household Label (e.g., *"Patel Household"*) & **Life Stage** badge (e.g., *"Family with Young Kids"*)
     - **San Antonio Area:** e.g., *"Near Medical Center (~1.5 mi away)"* + *Verified Local* badge
     - **Linked Family Members List:** Shows each household member's First Name, Photo, Age Bracket (`30s`), specific Gujarat Hometown (`Vadodara - Alkapuri` or `Surat - Vesu`), *Vouched by X Neighbors* count, and shared interest pills.
3. **Sending an Introduction:**
   - User taps **"Say Hello"** next to a household member and selects a 1-tap icebreaker (e.g., *"Kem cho! Saw you're also from Vadodara and live near Medical Center—would love to connect!"*) or writes a short 140-character note (URLs/phone numbers blocked pre-acceptance).
   - Recipient receives a Push Notification (and optional WhatsApp alert).
4. **Mutual Acceptance & WhatsApp Handoff:**
   - When the recipient taps **"Accept & Connect"**, both users unlock the **"Message on WhatsApp"** button.
   - Tapping **"Message on WhatsApp"** calls `get_whatsapp_handoff_link` and opens `https://wa.me/<phone>?text=<pre-filled_greeting>` directly inside WhatsApp.
5. **Post-Connection Peer Vouching:**
   - 48 hours after connecting, the app surfaces a lightweight prompt: *"Did you connect with [Name]? Vouch that they're genuinely from [Vadodara]."*
   - Confirming increments the user's public **"Vouched by Neighbors"** trust counter.
6. **Corridor Flip (San Antonio ⇄ Gujarat Map View):**
   - During Discovery, a floating **"Flip to Gujarat" / "Flip to San Antonio"** button in the bottom-right thumb zone flies the map camera between Greater San Antonio and Gujarat.
   - In Gujarat view, the San Antonio privacy ring is hidden, an anchor pin marks the user's selected Gujarat hometown, and matched San Antonio neighbors are projected onto their public Gujarat gazetteer coordinates (multi-origin households appear at each distinct member hometown with deterministic radial spread for co-located pins).
   - The bottom tray adapts to show each neighbor's Gujarat hometown alongside their San Antonio neighborhood and distance; tapping any Gujarat pin opens the same Household Bottom Sheet.