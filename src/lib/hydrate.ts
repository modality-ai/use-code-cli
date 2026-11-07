import React from "react";
import { hydrateRoot } from "react-dom/client";

// Centralized hydration helper so client entries don't duplicate the
// `if (typeof document !== "undefined") { ... }` boilerplate.
export function hydrateClient(Component: React.ComponentType<any>) {
  if (typeof document === "undefined") return;
  const root = document.getElementById("root");
  if (root) hydrateRoot(root, React.createElement(Component));
}
