# AGENTS.md — Second Home

Instructions for AI coding agents working in this repo. Read this fully before making changes.

## 1. Project overview

**Second Home** is a dual-location community discovery app for the Gujarat → Greater San Antonio, TX corridor. It connects diaspora families who are neighbors in San Antonio _and_ former neighbors in Gujarat.

- **Mobile (Expo)** is the only place users register and create pins (hardware GPS + device attestation).
- **Web (Next.js)** is a read-only viral preview map (H3 heatmap) that hands visitors to mobile via QR code.
- **Supabase** (Postgres + PostGIS + Auth + Edge Functions) is the backend. Upstash Redis does rate limits and nonces. Mapbox does maps.

### Source of truth

The specs in `docs/` are authoritative. **If code and docs conflict, or a spec is ambiguous, stop and ask the user. Don't guess.**

| File                                                        | Covers                                                           |
| :---------------------------------------------------------- | :--------------------------------------------------------------- |
| `docs/00_project_handoff.md`                                | Strategy, stack, **execution sequence (Steps 1–4)**, guardrails  |
| `docs/01_user_flows_core_funnel.md`                         | Flows A (web), B (mobile onboarding), C (discovery)              |
| `docs/02_mvp_feature_matrix.md`                             | Feature IDs F-01…F-17, priorities, non-goals, definition of done |
| `docs/03_data_privacy_schema.md`                            | SQL schema, RPCs, RLS, views                                     |
| `docs/04_anti_abuse_device_integrity_trust_architecture.md` | Attestation, geofence, rate limits, trust badges, moderation     |

Follow the execution sequence in `docs/00_project_handoff.md`. Don't build ahead of the current step.

## 2. Repo map

| Path                  | What                                                                                      | Runtime                         |
| :-------------------- | :---------------------------------------------------------------------------------------- | :------------------------------ |
| `apps/mobile`         | Expo + React Native + Expo Router (`src/app`)                                             | React Native / Metro            |
| `apps/web`            | Next.js App Router + Tailwind CSS                                                         | Node / browser                  |
| `packages/shared`     | `@second-home/shared`: enums, Zod schemas, constants, (later) gazetteer JSON + H3 helpers | Platform-agnostic TS            |
| `supabase/migrations` | Timestamped SQL migrations                                                                | Postgres                        |
| `supabase/functions`  | Edge Functions (`auth-challenge`, `create-household`, `join-household`, …)                | **Deno** (not a pnpm workspace) |

`packages/shared` ships TypeScript source with no build step (`exports` → `src/index.ts`). Next uses `transpilePackages`, and Metro compiles TS natively. Keep it free of DOM, React Native, and Node-only APIs.

## 3. Commands

Package manager is **pnpm** (workspaces) with **Turborepo**. Run from the repo root.

```bash
pnpm install
pnpm dev:web                       # Next.js dev server
pnpm dev:mobile                    # Expo dev server (interactive)
pnpm typecheck | lint | test | build
pnpm format | format:check
pnpm --filter @second-home/<web|mobile|shared> <script>
pnpm supabase migration new <name> # create a new migration file
```

On Windows PowerShell, if script execution is blocked, call `pnpm.cmd` / `npm.cmd` instead.
Node 24 LTS is recommended (`.nvmrc`). Expo officially supports LTS only.

## 4. 🚨 Non-negotiable privacy and security guardrails

Never violate these. Flag any request that would.

1. **Never** select, return, log, or expose `households.exact_current_geog` or `users.phone_e164` through any client-accessible query, view, RPC result, Edge Function response, or analytics event. Phone numbers are released **only** via `get_whatsapp_handoff_link` after a mutually accepted connection.
2. **Never** recompute `public_current_geog` on read. It is computed **once** at household creation (static 0.5–1.5 mi offset) and stored.
3. **Never** allow account registration or pin creation from the web app. Web is read-only.
4. **Never** build in-app chat. Accepted connections hand off to WhatsApp (`wa.me`) only.
5. Web heatmaps must use `web_h3_density_view` (H3 res-7, **≥ 2 households per cell**). Never render individual pins or cells with fewer than 2 households on web.
6. Every write mutation (`create_household`, `join_household`, `send_connection_request`) goes through an Edge Function that verifies device attestation (Apple App Attest / Google Play Integrity) and a single-use 60-second nonce.
7. Spatial query clamps stay in place: current radius ≤ 40,233 m (25 mi), hometown radius ≤ 80,467 m (50 mi), `LIMIT 100`.
8. Every new table enables **RLS in the same migration** that creates it. Supabase grants `ALL` on new `public` tables to `anon`/`authenticated`, and a column-level `REVOKE SELECT (col)` has **no effect** while a table-level grant exists. For tables with sensitive columns, `REVOKE ALL` at table level, then `GRANT SELECT (<explicit safe columns>)`. New columns stay private until deliberately added to the grant list. Clients must list columns explicitly (`select=*` fails).
9. Reject icebreakers containing URLs (`http://`, `https://`, `wa.me`, `t.me`) or phone numbers.

## 5. Database rules

- Change the schema only through new files in `supabase/migrations/` (`pnpm supabase migration new <name>`). **Never edit a migration that has been applied or committed.** Add a new one.
- Keep Postgres enums in sync with `packages/shared/src/enums.ts`. Change both in the same PR.
- `SECURITY DEFINER` functions must set `search_path` explicitly (prefer `''` with qualified names), must not leak revoked columns, and must `REVOKE EXECUTE ... FROM public, anon` then grant only to the roles that need it.
- Never put secrets or real user data in migrations or seed files.

## 6. Coding conventions

- TypeScript `strict`. No `any`. Prefer `unknown` plus Zod parsing.
- Validate **all** external input (request bodies, query params, RPC results from untrusted sources) with Zod schemas from `@second-home/shared`. Don't duplicate types per app.
- Mobile: Expo Router file-based routes in `apps/mobile/src/app`. Web: App Router in `apps/web/src/app`. Prefer server components on web unless interactivity requires a client component.
- Keep Edge Functions small, and return generic errors to clients (no stack traces, no internal IDs).
- Format with Prettier (`pnpm format`). Don't commit unformatted code.

## 7. Dependencies

- **Mobile:** install with `pnpm --filter @second-home/mobile exec expo install <pkg>` so versions match the Expo SDK. Run `expo-doctor` after dependency changes.
- **Web / shared:** `pnpm --filter <pkg> add <dep>`.
- Don't add new top-level frameworks or services that aren't in `docs/00_project_handoff.md` without asking.
- Always commit `pnpm-lock.yaml`. pnpm 10 blocks postinstall scripts, so allowlist new ones in `onlyBuiltDependencies` in `pnpm-workspace.yaml` only when required.

## 8. Environment and secrets

- Only `NEXT_PUBLIC_*` (web) and `EXPO_PUBLIC_*` (mobile) variables reach clients. Treat them as public.
- Service-role keys, Upstash tokens, and attestation secrets exist **only** in Edge Function secrets or server env. Never put them in app code, `.env.example`, or logs.
- Never commit `.env` files. Keep each app's `.env.example` up to date (names only).

## 9. Definition of done

Before you say a task is complete, run and pass:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm build            # required for web or shared changes
```

- Add or update tests for logic in `packages/shared`.
- For schema changes, check RLS and column privileges (a client JWT must not read `exact_current_geog` or `phone_e164`).
- Update this file and `docs/` when conventions or specs change.
- Keep changes scoped to the current step. Report anything out of scope instead of silently implementing it.
