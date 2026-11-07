# Plan: Make `client.js` Next.js-like (React Client Components via `use client`)

**Owner:** FRIDAY (planning/architecture) — assigned by SARAH (PO)
**Implementer:** JAMES (session `use-code-cli-4e`) — coding/build changes
**Location:** `/Volumes/GoldenSnake/git/use-code-cli`
**Status:** Phase 1 in progress
**Deliverable dir:** `_sdd/phrase01/`

## 0. Clarifications (from SARAH, 2026-11-07)

1. **Phase 1 scope = sessions only** as proof-of-concept; expand to all routes only after Phase 1 smoke test passes.
2. **React bundling = bundle React 19** via `Bun.build` with `splitting: true` (shared vendor chunk); no import-map.
3. **layout.tsx UMD tags = keep as fallback** during Phase 1; remove in Phase 4 after verification.
4. **Tests = manual smoke test** for Phase 1; automated `bun test` added in Phase 4.
5. **Routes that must not break:** sessions, tunnel, claude-login, session/[name], design, help. No deadline.

## 1. Goal

Make the web layer's client bundle behave like Next.js App Router client components:

1. `client.js` supports **real ES module imports** (`import { useState } from 'react'`) — no `window.React`/`window.ReactDOM` globals.
2. Client code can be **co-located with / imported from `page.tsx`** via a `'use client'` directive, instead of a separate auto-discovered `client.ts`.
3. Hydration uses bundled React 19, matching server-rendered HTML.

## 2. Current State

- `src/web/<route>/page.tsx` — Server Component (default export + `loadData()`). Rendered via `renderToString` + `RootLayout`.
- `src/web/<route>/client.ts` — uses `const React = (window as any).React;` globals. Compiled by `tools/build-client.ts` via `Bun.build({target:"browser", splitting:true})` into `public/dist/<route>/client.js`.
- `src/runner/server.ts` — auto-injects `<script type="module" src="/dist/<route>/client.js">` if bundle exists.
- `src/web/layout.tsx` — injects React 18 UMD + ReactDOM 18 UMD from unpkg.
- `package.json` — React 19.3.1 is a devDependency.

## 3. Target State (Next.js parity)

- A file marked `'use client'` is a **client entry point**; its imports (incl. `react`, `react-dom/client`) join the client graph.
- `page.tsx` may import client components directly; bundler traces the client graph from `'use client'` boundaries.
- No UMD globals; React 19 bundled (shared chunk via splitting).
- Server still renders initial HTML (SSR) and injects only needed client bundle(s).
- Hydration uses `hydrateRoot` from `react-dom/client` (React 19).

## 4. Phases

### Phase 0 — Baseline (no behavior change)
- [x] Confirm `bun run build:client` succeeds and bundles land in `public/dist`.
- [x] Smoke check: `grep -l "window.React" public/dist/*/client.js` to track migration.

### Phase 1 — ES module imports in `client.ts` (sessions only, proof-of-concept)
**Implementer: JAMES**
- [x] Migrate `src/web/sessions/client.ts` to use `import { useState, useEffect } from 'react'` and `import { createRoot } from 'react-dom/client'` instead of `window.*` globals. Replace `ReactDOM.createRoot(...).render(...)` with `createRoot(...).render(...)` (or `hydrateRoot` in Phase 4).
- [x] Update `tools/build-client.ts` so `Bun.build` resolves `react`/`react-dom` from `node_modules` and bundles them (keep `splitting: true` for shared vendor chunk). Entry glob remains `src/web/**/client.ts` for now.
- [x] Keep React 18 UMD `<script>` tags in `src/web/layout.tsx` as fallback during Phase 1 (do not remove yet).
- [x] Build (`bun run build:client`) and run `bun start`; verify sessions page hydrates with React 19, no console errors, SSE live updates still work.
- [x] Smoke test: `grep -l "window.React" public/dist/sessions/client.js` should be empty after migration; bundle contains React 19 code.

### Phase 2 — `'use client'` directive support (after Phase 1 smoke passes)
- [x] Define directive contract: first statement `'use client'`/`"use client"` → client entry point; all imports join client graph.
- [x] Extend `tools/build-client.ts` to discover client entry points by directive (candidate: `src/web/**/client.tsx`, `src/web/**/*Client.tsx`, or any file containing the directive), not just `**/client.ts`.
- [x] Server-side: resolve client bundle from page's imported client components (or keep per-route bundle naming).
- [x] Allow `page.tsx` to import a client component marked `'use client'` without breaking SSR.

### Phase 3 — Co-location / direct import from `page.tsx`
- [x] Support client component in same route dir imported by `page.tsx` (Next.js style).
- [x] Build client bundles only where a `'use client'` boundary exists.
- [x] Backward compat: routes with only `client.ts` (no directive) still build via legacy path during transition; emit deprecation note.

### Phase 4 — Hydration & verification
- [x] Switch client entry to `hydrateRoot` where SSR HTML exists (avoid re-render flicker).
- [x] Remove React 18 UMD `<script>` tags from `src/web/layout.tsx`.
- [x] Add automated tests in `src/runner/__tests__/` (SSR HTML contains component initial markup + bundle injected).
- [x] Migrate remaining routes (tunnel, claude-login, session/[name]) as proof-of-concept.
- [x] Expand to all routes after smoke passes.

## 5. Acceptance Criteria

- Phase 1: `grep -R "window.React" src/web/sessions` returns nothing; `bun run build:client` succeeds; bundle contains React 19 code (not UMD globals); sessions page hydrates with no console errors; SSE live updates work.
- Phase 4: no `window.React` references anywhere in `src/web`; no React 18 UMD script tags in rendered HTML; `bun test` passes; routes (sessions, tunnel, claude-login, session/[name], design, help) still function.

## 6. Files to Touch

- Phase 1: `src/web/sessions/client.ts`, `tools/build-client.ts`
- Phase 2/3: `tools/build-client.ts`, `src/runner/server.ts`, `src/web/**/page.tsx`, new client components
- Phase 4: `src/web/layout.tsx`, `src/web/**/client.ts`, `src/runner/__tests__/`

## 7. Risks

- Bundling React into every route's client.js increases bundle size; mitigate with `splitting: true` shared chunks.
- Hydration mismatches if server/client render differ; require deterministic initial state.
- Build time increase; acceptable for dev.

## 8. Out of Scope

- RSC streaming / selective hydration.
- Server Actions.
- App Router file conventions beyond `page.tsx`/`client.ts`.

---

*Plan refined by FRIDAY per SARAH's clarifications. Phase 1 dispatched to JAMES (session use-code-cli-4e).*
