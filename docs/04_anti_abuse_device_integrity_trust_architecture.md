# 04 — Anti-Abuse, Device Integrity & Trust Architecture (Gujarat → San Antonio V1)

## 1. Core Security & Trust Philosophy
- **Silent Gates Over User Friction:** Never force legitimate users through CAPTCHAs, ID uploads, or multi-page forms. Push bot and spoof detection silently into hardware attestation and backend Edge Functions.
- **Shadow Quarantine ("Soft Gate"):** Newly created accounts can browse the map immediately, but remain in `status = 'quarantined'` (invisible to other users) until device attestation, SMS OTP, and San Antonio geofence checks succeed.
- **Progressive Social Proof:** Rather than binary "verified vs. unverified" lockouts for hometown claims, surface layered trust signals (*Verified Local*, *Vouched by Neighbors*, *Account Age*) so community members can judge authenticity naturally.

---

## 2. Layer 1: Hardware & App Attestation (Anti-Bot Gate)
Every write mutation (`create_household`, `join_household`, `send_connection_request`) must pass through a Supabase Edge Function that validates a cryptographic device attestation token.

### Attestation Handshake Flow
1. **Challenge Nonce:** Mobile client requests a single-use, 60-second cryptographic `nonce` from `POST /functions/v1/auth-challenge` (stored in Upstash Redis).
2. **OS-Level Signing:**
   - **iOS:** Client calls `DCAppAttestService.generateAssertion` using the server `nonce` + request payload hash.
   - **Android:** Client calls Google `IntegrityManager.requestIntegrityToken` with `nonce` + payload hash.
3. **Server Verification:**
   - Edge Function verifies the Apple assertion signature / Google Play Integrity verdict (`MEETS_DEVICE_INTEGRITY` + `APP_RECOGNIZED`).
   - Requests from rooted/jailbroken devices, emulators, or unsigned scripts are rejected with `403 Forbidden` before touching PostgreSQL.

---

## 3. Layer 2: GPS Integrity, Geofencing & Anti-Spoofing

### A. San Antonio Launch Geofence
- At household creation, `exact_current_geog` must fall within the **Greater San Antonio Metro Bounding Polygon** (covering Bexar County and immediate adjacent commuter corridors including Boerne, Schertz/Cibolo, and New Braunfels).
- Coordinates outside this polygon route the user to the **Metro Expansion Waitlist (`F-17`)** rather than creating a live household pin.

### B. Mock Location & Spoofing Checks
| Check | Mechanism | Action on Failure |
| :--- | :--- | :--- |
| **OS Mock Flag** | Reject payloads where Android `Location.isMock()` is `true` or iOS `CLLocationSourceInformation.isSimulatedBySoftware` is `true`. | Block pin creation; prompt user to disable mock GPS apps. |
| **Coordinate Precision Anomaly** | Reject synthetic coordinates rounded to exact integers or suspiciously low decimal precision (`< 4` decimal places) lacking natural GPS horizontal accuracy metadata (`accuracy_meters`). | Flag session; hold account in `quarantined` state. |
| **Impossible Travel ("Teleportation")** | Compare consecutive GPS pings against prior `last_verified_at` timestamps. Flag speed transitions exceeding `600 mph` (e.g., jumping from India to San Antonio in 5 minutes). | Lock pin updates for 24 hours; require fresh hardware attestation. |
| **Household Join Proximity Check** | When a spouse/family member uses a household `invite_code`, verify their live GPS fix is within **25 miles** of the household's `exact_current_geog` (prevents sharing invite codes with friends in other states/countries to spoof residency). | Reject household link; prompt them to create their own household pin. |

---

## 4. Layer 3: Rate Limiting, Anti-Scraping & Enumeration Defense

Attackers often attempt to scrape user density by iterating spatial queries across a grid. Enforce the following controls at the Edge/RPC layer:

1. **Spatial Query Clamping (`find_matching_households`):**
   - Clamp `p_current_radius_meters` to a maximum of `40,233` meters (**25 miles**).
   - Clamp `p_hometown_radius_meters` to a maximum of `80,467` meters (**50 miles**).
   - Hard-cap returned rows at `LIMIT 100` households per query.
2. **Upstash Redis Rate Limits (Sliding Window):**
   - **Map Pan/Query RPC:** Max `30 requests / minute` per authenticated user; `10 requests / minute` per IP for anonymous web H3 views.
   - **Connection Requests (`connections` insert):** Max `10 outbound requests / 24 hours` for new accounts (`< 7 days` old); `25 / 24 hours` for `Verified Local` accounts.
   - **SMS OTP Triggers:** Max `3 OTP sends / hour` per phone number and per device attestation ID.
3. **Static Fuzzing Offset (Anti-Triangulation):**
   - `public_current_geog` is computed **once** when the household is created and persisted in the database—never recomputed dynamically per query. Dynamic random offsets allow attackers to average multiple queries to find the exact center point; a static offset keeps the pin stationary inside its 0.5–1.5 mile privacy ring.

---

## 5. Layer 4: Progressive Trust Signals & Community Moderation

### A. Automated Trust Badges
| Badge | Trigger Rule | Why It Proves Authenticity |
| :--- | :--- | :--- |
| **`Verified Local`** (`households.is_verified_local`) | Awarded automatically when the client submits **2+ foreground session heartbeats** inside the San Antonio metro area separated by at least **7 days** (within 15 miles of `exact_current_geog`). | Filters out transient visitors, VPN testers, and one-off spoofers who do not actually reside in San Antonio. |
| **`Vouched by Neighbors`** (`users.vouch_count`) | Unlocked 48 hours after two users mutually accept a connection. Either user can tap *"Vouch that [Name] is from [Hometown]"* (limited to 1 vouch per pair; only `active` users can vouch). | Creates a self-policing web of trust; scammers cannot fake peer endorsements from established community members. |
| **`Hometown Visit`** *(Optional P1)* | Awarded if an authenticated user opens the app while hardware GPS places them within **25 miles** of their claimed `hometown_geog` in Gujarat. | Cryptographically confirms physical presence in their claimed home city during a visit back to India. |

### B. Abuse Reporting & Auto-Quarantine Rules
- **1-Tap Block (`connections.status = 'blocked'`):** Immediately hides both users' households from each other's map queries and revokes access to `get_whatsapp_handoff_link`.
- **Report Threshold Auto-Quarantine:**
  - Any account receiving **3+ reports from distinct `Verified Local` users** within 30 days triggers an automated database update flipping `users.status = 'quarantined'` and queuing the account for manual review.
- **Spam Icebreaker Filter:** Reject connection icebreakers containing URLs (`http://`, `https://`, `wa.me`, `t.me`) or phone numbers in the initial request payload so spammers cannot bypass mutual acceptance to drop phishing links.