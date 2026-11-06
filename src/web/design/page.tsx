import React from "react";
import { readFileSync } from "node:fs";

export interface DesignPageProps {
  rendered: string;
}

export default function DesignPage({ rendered }: DesignPageProps) {
  return React.createElement(
    "div",
    { className: "max-w-[960px] mx-auto my-6 p-4" },
    React.createElement("article", {
      className: "prose prose-neutral dark:prose-invert bg-surface border border-border rounded-xl p-6",
      dangerouslySetInnerHTML: { __html: rendered },
    })
  );
}

export async function loadData(): Promise<DesignPageProps> {
  let rendered = "";
  try {
    const md = readFileSync(new URL("../../../design.md", import.meta.url), "utf8");
    rendered = (Bun as any).markdown.html(md);
  } catch (err) {
    rendered = `<p>Error reading design.md: ${String(err)}</p>`;
  }
  return { rendered };
}
