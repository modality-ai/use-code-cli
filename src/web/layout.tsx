import React from "react";
import { readFileSync } from "node:fs";

export interface RootLayoutProps {
  children?: React.ReactNode;
  title?: string;
  cssHref?: string;
}

function resolveCssHref(): string {
  try {
    const manifestPath = new URL("../../public/styles/manifest.json", import.meta.url).pathname;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return manifest.style ?? manifest.tailwind ?? "/styles/style.css";
  } catch {
    return "/styles/style.css";
  }
}

const themeVars = `:root { --paper:#fbf7ef; --surface:#fffdf8; --border:#d8d4cb; --text-primary:#23262b; --text-muted:#5b5f66; --accent:#1f6f78; }
@media (prefers-color-scheme: dark) { :root { --paper:#1a1b1e; --surface:#22252a; --border:#3a3e44; --text-primary:#e8e6e1; --text-muted:#a6a9ae; --accent:#4dacb2; } }
body { margin:0; }`;

export default function RootLayout({ children, title = "use-code-cli", cssHref }: RootLayoutProps) {
  const href = cssHref ?? resolveCssHref();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <link rel="stylesheet" href={href} />
        <script crossOrigin="anonymous" src="https://unpkg.com/react@18/umd/react.development.js" />
        <script crossOrigin="anonymous" src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" />
      </head>
      <body className="bg-paper text-text-primary font-body">
        <div id="root" className="max-w-240 mx-auto my-lg p-md mt-0">{children}</div>
      </body>
    </html>
  );
}
