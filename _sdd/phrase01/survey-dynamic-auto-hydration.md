# Survey: Dynamic & Automatic Hydration of Client Components

**Scope:** How to remove the per-file `hydrateClient(Component)` / inline `hydrateRoot(...)` boilerplate and make hydration automatic, while keeping SSR HTML reuse and per-route bundles. Builds on the existing `hydrateClient` helper in `src/lib/hydrate.ts` and the `'use client'` build contract in `tools/build-client.ts`.

**Date:** 2026-11-08

---

## 1. Current State (manual)

Each client entry ships its own hydration tail:

- `src/web/tunnel/TunnelApp.client.tsx` — ends with `hydrateClient(TunnelApp);` (uses centralized helper).
- `src/web/sessions/SessionsApp.client.tsx` — ends with inline `if (typeof document !== "undefined") { const root = document.getElementById("root"); if (root) hydrateRoot(root, React.createElement(SessionsApp)); }`.
- `src/web/session/[name]/SessionView.client.tsx` — same inline pattern.
- `src/web/claude-login/ClaudeLoginApp.client.tsx` — **no hydration call at all** (component never hydrates; it relies on DOM listeners attached in `useEffect`, which never runs because there is no hydrate).

So hydration is **opt-in and inconsistent**: some files use the helper, some inline, one forgets entirely. The helper centralizes the `document` guard + `#root` lookup but still requires every author to (a) import it and (b) invoke it with the right component. That is the boilerplate the task wants to eliminate.

---

## 2. Goal

Make hydration **automatic and dynamic**:

- A `'use client'` entry (or a co-located page import) hydrates itself with **no trailing call**.
- The component to hydrate is resolved **dynamically** (from the module's default export or a registry), not hard-coded at the call site.
- SSR HTML is still reused via `hydrateRoot` (no re-render flicker).
- Per-route bundle injection by `server.ts` keeps working; no UMD globals.

Non-goals: RSC streaming, selective/partial hydration of islands, Server Actions (out of scope per plan).

---

## 3. Candidate Approaches

### A. Build-time injection (recommended)

`tools/build-client.ts` already knows every entry point. At build time, append (or wrap) a tiny hydration shim to each entry output:

```ts
// injected into each entry bundle tail
import __Default__ from "./<entry>";
if (typeof document !== "undefined") {
  const __root = document.getElementById("root");
  if (__root) hydrateRoot(__root, React.createElement(__Default__));
}
```

- **Pros:** Zero author boilerplate; impossible to forget; component resolved from default export; works with existing `hydrateClient` semantics; build owns the contract (matches Next.js "entry point hydrates itself").
- **Cons:** Requires build tool change; entries must default-export a component (already the convention); harder to pass props from `window.__REACT_DATA__` unless the shim reads them.

Props handling: the shim can read the route slice dynamically, e.g. `window.__REACT_DATA__` and pass it as `initial`/props. But prop shapes differ per component, so a generic shim cannot know which prop to pass. Options:
  1. Keep a **per-component hydration adapter** exported alongside the default (e.g. `export function hydrateProps() { return { initial: window.__REACT_DATA__?.sessions }; }`).
  2. Have the component read `window.__REACT_DATA__` itself (current pattern in `SessionsApp`/`SessionView`) — then the shim only needs the default export. **Simplest and consistent with the consolidated data channel.**

### B. Runtime auto-discovery via data attributes

Server renders a marker on the root: `<div id="root" data-hydrate="sessions/SessionsApp">`. A single global bootstrap (injected on every page) dynamically imports the entry and hydrates:

```ts
const name = document.getElementById("root")?.dataset.hydrate;
if (name) {
  const mod = await import(`/dist/${name}.js`); // already loaded via script tag
  hydrateRoot(root, React.createElement(mod.default));
}
```

- **Pros:** One bootstrap for all routes; hydration becomes truly "dynamic" (route decides component by attribute).
- **Cons:** Duplicate import/hydration race with the already-injected `<script type="module">`; requires careful ordering; reintroduces a global bootstrap bundle; less type-safe. Essentially re-implements what the script tag already does.

### C. Single root entry + route registry

One client bundle for the whole app with a route→component map; `server.ts` injects it plus a tiny `window.__ROUTE__` hint. The bundle picks the component and hydrates.

- **Pros:** One hydration site; shared chunks already; easy to centralize.
- **Cons:** Defeats per-route code splitting; every route downloads all client components; breaks the "only bundle where a `'use client'` boundary exists" rule. Not recommended for this repo.

### D. Component-level `use client` auto-hydration (Next.js-style)

In Next.js, the framework generates the client references and hydration happens automatically because the RSC payload carries component references. We do not have RSC; our SSR is plain `renderToString`. To mimic this we'd need a payload format listing client component boundaries and a runtime that walks it.

- **Pros:** True parity with Next.js.
- **Cons:** Large scope (RSC payload, client references, selective hydration) — explicitly out of scope. Not for Phase 1–4.

### E. Keep manual but make it ergonomic (status quo + lint)

Retain `hydrateClient(Component)` but add an ESLint/TS rule or test asserting every `*.client.tsx` ends with a hydration call; fix the `claude-login` omission.

- **Pros:** Minimal change; explicit; easy to debug.
- **Cons:** Still boilerplate; still forgettable; does not satisfy "automatic".

### F. Decorator / macro (compile-time)

Use a Babel/SWC-like transform or a Bun plugin to rewrite `export default function Foo()` in `*.client.tsx` into `export default function Foo() {...}` + appended hydration. Essentially same as A but at source-transform time.

- **Pros:** Source stays clean; no build-output surprises.
- **Cons:** Extra tooling complexity; Bun.build plugins are doable but more moving parts than A.

---

## 4. Comparison

| Approach | Boilerplate removed | Dynamic resolution | SSR reuse (`hydrateRoot`) | Per-route splitting | Effort | Risk |
|----------|---------------------|--------------------|---------------------------|---------------------|--------|------|
| A. Build-time injection | Yes | Via default export | Yes | Yes | Low | Low |
| B. Runtime auto-discovery | Yes | Via data attribute | Yes | Yes | Medium | Medium (ordering races) |
| C. Single root bundle | Yes | Via route map | Yes | No (all routes) | Medium | High (bundle bloat) |
| D. RSC-style | Yes | Framework-generated | Yes | Yes | Very high | High |
| E. Manual + lint | No | No | Yes | Yes | Very low | Low (still forgettable) |
| F. Compile-time macro | Yes | Via default export | Yes | Yes | Medium | Medium |

---

## 5. Recommendation

**Adopt Approach A (build-time injection)** as the primary mechanism, with two refinements:

1. **Convention: default export is the hydrate target.** Every `*.client.tsx` already default-exports its component (`TunnelApp`, `SessionsApp`, `SessionView`, `ClaudeLoginApp`). The build shim hydrates `mod.default`. This removes the trailing call from all four files (including fixing the `claude-login` omission).

2. **Component reads its own props from `window.__REACT_DATA__`.** Already the case for `SessionsApp`/`SessionView` (they read `window.__REACT_DATA__?.sessions` / `?.sessionView`). `TunnelApp` and `ClaudeLoginApp` take no SSR props (or read from DOM), so a parameterless `hydrateRoot(root, createElement(mod.default))` is correct. No per-component adapter needed.

3. **Keep `src/lib/hydrate.ts` as the single implementation** of the guard + `#root` lookup, but move the *call* into the build shim by importing the helper from a shared chunk. Concretely, the shim becomes:

   ```ts
   import { hydrateClient } from "/src/lib/hydrate"; // resolved by Bun splitting into shared chunk
   import Component from "<entry>";
   hydrateClient(Component);
   ```

   This reuses the existing helper instead of duplicating `hydrateRoot` logic, and keeps a single source of truth.

4. **Escape hatch:** allow an entry to opt out of auto-hydration by exporting `export const autoHydrate = false;` (or a `// no-hydrate` pragma) for components that are mounted manually (e.g. embedded widgets). Build shim checks the flag before calling.

5. **Verification:** keep/extend `src/runner/__tests__/web-page.test.ts` to assert each hydrated route's bundle is injected; add a build-time check (or test) that no `*.client.tsx` contains a trailing `hydrateClient(` / `hydrateRoot(` call after migration — i.e. hydration lives only in the shim.

### Why not B/C/D

- B's data-attribute indirection adds a runtime registry and ordering hazards for no benefit given we already inject a per-route script.
- C breaks per-route splitting, a stated goal.
- D is real Next.js parity but explicitly out of scope (RSC payload work).

---

## 6. Migration Steps (for JAMES)

1. Update `tools/build-client.ts`: after `Bun.build`, for each entry output, append a shim module OR (cleaner) generate a tiny companion `*.hydrate.js` per entry that imports the entry's default export + `hydrateClient`. Simplest: keep entries as-is but have the build post-process each entry file to append:
   ```js
   import("./<entry>.js").then(m => { if (m.autoHydrate !== false && m.default) hydrateClient(m.default); });
   ```
   However dynamic import in an already-loaded module is awkward. Preferred: use Bun.build's ability to treat a generated entry wrapper as the real entrypoint — create in-memory wrapper files during build:
   ```ts
   // generated wrapper for src/web/tunnel/TunnelApp.client.tsx
   export * from "../../src/web/tunnel/TunnelApp.client.tsx";
   import Component from "../../src/web/tunnel/TunnelApp.client.tsx";
   import { hydrateClient } from "../../src/lib/hydrate.ts";
   if (Component?.autoHydrate !== false) hydrateClient(Component);
   ```
   and build the wrapper instead of the raw file. Output naming must still resolve to `/dist/tunnel/TunnelApp.client.js` (use `naming` + entrypoint path tricks, or post-build rename).
2. Remove trailing hydration calls from `TunnelApp.client.tsx`, `SessionsApp.client.tsx`, `SessionView.client.tsx`, and (newly) add none to `ClaudeLoginApp.client.tsx`.
3. Ensure `hydrate.ts` is included in the client graph (it already is, via tunnel; sessions/sessionview currently import `hydrateRoot` directly — switch them to import `hydrateClient` for consistency, then they need no call at all).
4. Run `bun run build:client`, `bun run build:types`, `bun test`; smoke-test all six protected routes.

---

## 7. Risks & Open Questions

- **Default-export requirement:** If a client file uses a named export only, auto-hydration silently no-ops. Mitigate with a build-time assertion that every entry has a default export.
- **Props:** Components must self-read `window.__REACT_DATA__` (already the contract). Any future component needing SSR-passed props should follow the same self-read pattern; document this in the client component authoring guide.
- **Double hydration:** If a file keeps a manual call AND the shim runs, `hydrateRoot` twice throws. Migration must remove manual calls in the same change. Add a test/grep guard.
- **Opt-out escape hatch** (`autoHydrate = false`) must be honored; document it.
- **SSR determinism:** Unchanged — auto-hydration still calls `hydrateRoot` on `#root` with the default export; no change to server output.

---

## 8. Implications for This Project

- Closes the last inconsistency (claude-login never hydrates).
- Makes the `'use client'` boundary self-sufficient: a file marked `'use client'` is a complete client entry — definition + hydration — with no extra ritual, mirroring Next.js where the framework handles hydration.
- Aligns with the consolidated `window.__REACT_DATA__` channel: hydration needs no props plumbing because components read their slice themselves.

---

*Survey authored by FRIDAY. Awaiting SARAH/JAMES decision before implementation.*
