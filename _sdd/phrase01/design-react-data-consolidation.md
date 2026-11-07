# Design: Consolidate Hydration Data into `window.__REACT_DATA__`

**Owner:** FRIDAY (design) — assigned by SARAH (PO)
**Implementer (planned):** JAMES (session `use-code-cli-51`)
**Location:** `/Volumes/GoldenSnake/git/use-code-cli`
**Status:** Design + inventory — awaiting PO approval before implementation dispatch

## 1. Problem

Hydration data is currently scattered across per-route global variables:

- `window.__SESSIONS__` (sessions route) — array of session objects.
- `window.__SESSION_VIEW__` (session/[name] route) — `{ name, initial }`.

Each route invents its own global name and shape. There is no uniform data channel, so adding a new hydrated route means inventing another `window.__X__`. This design consolidates all hydration data into a single `window.__REACT_DATA__` object holding per-route slices.

## 2. Inventory of Existing Globals

| Global | Route | Producer (SSR) | Consumer (client) | Shape |
|--------|-------|----------------|-------------------|-------|
| `window.__SESSIONS__` | `/sessions` | `src/web/sessions/page.tsx` (payloadHtml script) | `src/web/sessions/SessionsApp.tsx` (useState init, window read) | `Session[]` |
| `window.__SESSION_VIEW__` | `/session/:name` | `src/web/session/[name]/page.tsx` (payloadHtml) | `src/web/session/[name]/SessionView.tsx` (BootProps read) | `{ name: string; initial: SessionData \| null }` |

Injection points:
- `src/web/sessions/page.tsx` line 16: `payloadHtml={`window.__SESSIONS__ = ${JSON.stringify(sessions)...}`}`
- `src/web/session/[name]/page.tsx` line 15: `payloadHtml = \`window.__SESSION_VIEW__ = ...\``
- Consumers read via `window.__SESSIONS__` / `window.__SESSION_VIEW__` inside `'use client'` components.

Tests referencing globals:
- `src/runner/__tests__/web-page.test.ts:40` asserts `html` contains `"window.__SESSIONS__ ="`.

No other `window.__*` data globals exist in `src/` or `tools/`.

## 3. Proposed Data Shape

A single global object keyed by **route slice name**, with a small envelope:

```ts
// Declared once (e.g. in src/web/react-data.ts or layout)
interface ReactDataEnvelope {
  // Per-route slices, populated only on the route that needs them.
  sessions?: Session[];          // /sessions
  sessionView?: {               // /session/:name
    name: string;
    initial: SessionData | null;
  };
  // Future slices appended here as new hydrated routes are added.
}

declare global {
  interface Window {
    __REACT_DATA__?: ReactDataEnvelope;
  }
}
```

Rationale:
- **One namespace** instead of N globals → predictable discovery (`window.__REACT_DATA__`).
- **Per-route slices** keep payload size minimal (only the slice for the current route is populated).
- **Optional keys** make it easy to add new routes without breaking existing readers during migration.
- Envelope (rather than flat merge) avoids key collisions and keeps per-route ownership clear.

## 4. SSR → Client Contract

1. Server (`page.tsx`) builds its slice object and emits a single payload script:
   ```ts
   const payloadHtml = `window.__REACT_DATA__ = ${JSON.stringify({ sessions }).replace(/</g,"\\u003c")};`;
   ```
   For routes with multiple slices, merge into the same object (server owns the whole object for that request).
2. The payload script is injected into the SSR HTML (existing `payloadHtml` mechanism inside the hydrated node, using `dangerouslySetInnerHTML` — hydration-safe, since React never compares that content).
3. Client component reads `window.__REACT_DATA__?.<slice>` with fallback to the prop/dehydrated value, exactly as today (`SessionsApp` reads `window.__SESSIONS__` with `initial` fallback).

Determinism rule (kept from Phase 4): client must not render slice-dependent markup until after first live tick where needed, to keep SSR and hydration markup identical.

## 5. Population Strategy

- **Per-route, server-side**: each `page.tsx` constructs only its own slice and assigns the whole `window.__REACT_DATA__` object (single writer per request → no merge races).
- **No client-side writes** to `__REACT_DATA__` except possibly a one-time normalization shim during transition (see §6).
- Layout does not populate data; it only ensures the global type declaration exists.

## 6. Migration Plan (backward-compat during transition)

Phase A — **Additive (no breakage)**:
- Introduce `window.__REACT_DATA__` alongside existing globals.
- Each `page.tsx` emits **both** the new consolidated object AND the legacy global (e.g. `window.__SESSIONS__ = ...; window.__REACT_DATA__ = { sessions: ... };`) OR a tiny shim that mirrors: `window.__REACT_DATA__ = window.__REACT_DATA__ || {}; window.__REACT_DATA__.sessions = window.__SESSIONS__;`.
- Client readers prefer `window.__REACT_DATA__?.sessions`, falling back to `window.__SESSIONS__`.

Phase B — **Switch readers**:
- Update `SessionsApp.tsx` and `SessionView.tsx` to read from `window.__REACT_DATA__` only.
- Update tests to assert `window.__REACT_DATA__` presence.

Phase C — **Remove legacy globals**:
- Drop `window.__SESSIONS__` / `window.__SESSION_VIEW__` emission.
- Remove legacy fallbacks in readers.
- Update tests accordingly.

Each phase is independently shippable and testable; Phase A/B keep old tests green.

## 7. Implementation Approach (co-work with JAMES)

1. FRIDAY (this session): finalize this design doc (done) + report to SARAH for approval.
2. On approval: dispatch Phase A to JAMES (use-code-cli-51):
   - Add shared type declaration file `src/web/react-data.ts` (or extend a common types file) exporting `ReactDataEnvelope` and the global augmentation.
   - Update `sessions/page.tsx` and `session/[name]/page.tsx` to emit `window.__REACT_DATA__`.
   - Update readers to prefer the new object with legacy fallback.
   - Update `src/runner/__tests__/web-page.test.ts` to assert `window.__REACT_DATA__` (keep legacy assertion during Phase A).
3. Phase B/C dispatched after Phase A verification.

Files likely touched:
- New: `src/web/react-data.ts` (types + global augmentation)
- `src/web/sessions/page.tsx`, `src/web/sessions/SessionsApp.tsx`
- `src/web/session/[name]/page.tsx`, `src/web/session/[name]/SessionView.tsx`
- `src/runner/__tests__/web-page.test.ts`

## 8. Acceptance Criteria

- Single `window.__REACT_DATA__` object is the data channel for all hydrated routes.
- All hydration reads (`SessionsApp`, `SessionView`) consume from `window.__REACT_DATA__`.
- No scattered `window.__SESSIONS__` / `window.__SESSION_VIEW__` globals remain after Phase C.
- `bun run build:client` succeeds; `tsc -p ./` clean; `bun test` passes.
- Backward-compat: Phase A keeps legacy globals so in-flight clients don't break; removed only in Phase C.

## 9. Risks

- SSR/hydration determinism: must keep the payload script inside the hydrated node with `dangerouslySetInnerHTML` (React never compares it). Already the pattern; preserve it.
- Test assertions: existing test asserts `"window.__SESSIONS__ ="`. During Phase A, keep that assertion AND add `__REACT_DATA__`; switch in Phase C.
- Scope creep: only the two existing globals are in scope; new slices added later follow this contract.

---

*Design authored by FRIDAY. Awaiting SARAH approval before dispatching Phase A to JAMES.*
