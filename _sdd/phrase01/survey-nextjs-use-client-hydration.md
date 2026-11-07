# Survey: How Next.js Uses the `"use client"` Directive for Server/Client Hydration

**Scope:** Next.js App Router (React Server Components model). Focus on the role of the `"use client"` directive in drawing the server/client boundary and coordinating hydration.

**Source:** Next.js official docs — "The Server and Client Boundary" & "use client" directive reference (fetched 2026-11-07).

---

## 1. Mental Model

React Server Components (RSC) split a single component tree across **two module graphs**:

- **Server module graph** — Server Component code runs here only; never ships to the browser.
- **Client module graph** — Client Component code runs in both environments.

Both graphs compose into one tree. The server renders it into the **RSC Payload** (a serialized description of the UI that carries references to the Client Components inside it). Next.js then uses the payload + Client Components to produce HTML (SSG/ISR/SSR).

The directive `"use client"` is the **entry-point marker** that moves a module from the server graph into the client graph.

---

## 2. What `"use client"` Actually Does

- It is a **React feature**, adopted by Next.js.
- Placed at the **top of a file, before any imports**. Applies to the **entire module**; cannot be placed inside a component/function.
- Marks the file as a **client entry point**. Every module imported from that entry becomes part of the **client module graph** (and is therefore shipped to the browser).
- You only need it on files whose components are **rendered directly within Server Components** — not on every file that contains Client Components.

```tsx
// app/components/counter.tsx
'use client'

import { useState } from 'react'

export default function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  )
}
```

---

## 3. The Two Boundary Rules

The directive draws a boundary in the module graph. Two rules decide what crosses it:

| What | How it crosses | Constraint |
|------|----------------|------------|
| **Code** | Through **imports** | Everything a Client Component imports is pulled into the **client bundle** |
| **Data** | Through **props** | Props must be **serializable** (JSON-compatible). Functions like event handlers **cannot** cross |

Additional notes:

- Passing a function as a prop from a Server Component to a Client Component **throws**. An `onClick` handler cannot cross.
- A **Server Function** (`'use server'`) crosses as a **reference** (callable from the client).
- A **rendered React element** can cross because it is serializable data. Passing rendered output as `children` lets a Server Component nest inside a Client Component **without** importing the Server Component's code into the client graph (composition pattern).

---

## 4. Hydration Coordination

### 4.1 Rendering environments

| Component type | Renders on server? | Runs in browser? |
|----------------|--------------------|------------------|
| Server Component | Yes | No |
| Client Component | Yes (SSR/SSG/ISR) | Yes (hydration) |

"Client" means the component **also** runs in the browser, alongside its server render. The word "client" does **not** mean "client-only" — a Client Component still produces HTML on the server.

### 4.2 Direct visit (initial load)

1. Server renders the Server Component tree → produces the **RSC Payload**.
2. Next.js uses the payload + Client Components to render **HTML** (SSR/SSG/ISR).
3. The RSC Payload ships **with** the HTML to the browser.
4. The browser **hydrates** the Client Components from the payload, making the initial HTML interactive.

A Client Component's code (e.g. `console.log`) runs **twice** on a direct visit: once on the server, once in the browser during hydration.

### 4.3 Client-side navigation

1. Server renders → sends only the **RSC Payload** (no server-rendered HTML).
2. The Client Component renders **in the browser** from the payload.
3. No hydration of server HTML occurs in this path.

### 4.4 Key distinction

- **"Server-rendered"** = how Next.js produced the HTML.
- **"Server Component"** = where the component code runs and whether it ships to the browser.

RSC keeps Server Component code on the server and emits the RSC Payload **instead** of shipping that code. These are separate concerns.

---

## 5. Practical Best Practices

- **Push `'use client'` down to the smallest leaf** — the actual interactive element. Don't mark a whole page or layout client.
- **Pass server-fetched data into Client Components as props**, rather than fetching inside them.
- **Keep data access, secrets, and non-interactive rendering on the server.**
- **Use the composition pattern**: pass Server Component output as `children`/rendered elements into a Client Component shell, so server code never enters the client bundle.
- **Wrap shared components**: create a thin Client Component wrapper that imports a shared (server-safe) module and put the directive on the wrapper — keeps the shared module unchanged and moves the boundary closer to app code.
- **Props must be serializable**: avoid passing functions (use Server Functions for actions), class instances, or non-JSON values.

---


## 8. Code-Level Enforcement in `vercel/next.js`

The directive is not just a convention — Next.js enforces it at the **TypeScript language-service layer** (`packages/next/src/server/typescript/rules/client-boundary.ts`). When a file has `"use client"`, the rule inspects the exported component's props type and emits warnings:

- A prop typed as a **function** is rejected **unless** its name is `action` or ends with `Action` (treated as a Server Action reference).
- Special-case allowance: in `error.tsx` / `global-error.tsx`, the framework-injected `reset` and `retry` props may be functions (Next.js provides them; the user doesn't pass them).
- Props typed as **constructors or classes** are rejected (non-serializable).
- Message: *"Props must be serializable for components in the 'use client' entry file."*

This is the concrete mechanism behind the "data crosses via serializable props" rule: the compiler validates serializability at authoring time, not just at runtime.

### React-side reference
React's own docs define the serializable types that may cross the boundary and how `hydrateRoot` consumes the payload: https://react.dev/reference/rsc/use-client

## 6. Common Pitfalls

- Adding `'use client'` to almost every file "to make errors go away" — defeats RSC benefits, bloats the client bundle, and hurts performance/SEO.
- Treating `'use client'` as "CSR only" — it still SSRs and hydrates; it is not a "skip server" flag.
- Passing non-serializable props (e.g. `onClick`) from Server → Client → runtime error.
- Importing a Server Component into a Client Component file pulls server-only code into the client bundle (boundary violation; compiler will flag it).
- Content gated behind user interaction never appears in the initial HTML → poor SEO for that content.

---

## 7. Implications for This Project (use-code-cli)

This repo mimics Next.js App Router conventions (`src/web` with `layout.tsx`, route handlers, etc.) on top of Hono + React. When porting the hydration model:

- Server-rendered HTML + hydration requires a clear **server/client boundary**; mark only truly interactive leaves with `'use client'`.
- Data must flow **server → client via serializable props** (no function props unless Server Functions).
- Prefer **composition** (pass server-rendered `children` into client shells) to keep server code out of the browser bundle.
- Distinguish SSR (HTML) from RSC (payload) when reasoning about what ships.

---

## References

- Next.js — "The Server and Client Boundary": https://nextjs.org/docs/app/guides/server-and-client-boundary
- Next.js — "Server and Client Components" (getting started): https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js — `use client` directive reference: https://nextjs.org/docs/app/api-reference/directives/use-client
- React — `hydrateRoot`: https://react.dev/reference/react-dom/client/hydrateRoot
- React — `use client` directive & serializable types: https://react.dev/reference/rsc/use-client
- Next.js source — TypeScript client-boundary rule: https://github.com/vercel/next.js/blob/canary/packages/next/src/server/typescript/rules/client-boundary.ts
