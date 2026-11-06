import React from "react";
import { readFileSync } from "node:fs";

export interface DesignPageProps {
  rendered: string;
}

export default function DesignPage({ rendered }: DesignPageProps) {
  const styles = `body { margin:0; font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif; background:var(--paper); color:var(--text-primary); }
.container { max-width:960px; margin:24px auto; padding:16px; }
article { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:24px; }
article h1, article h2, article h3 { color:var(--text-primary); }
article h1 { font-size:28px; margin:0 0 16px; }
article h2 { font-size:22px; margin:24px 0 12px; }
article h3 { font-size:18px; margin:16px 0 8px; }
article p, article li { line-height:1.6; }
article code { font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,monospace; font-size:13px; background:var(--paper); padding:2px 4px; border-radius:4px; }
article pre { background:var(--paper); border:1px solid var(--border); border-radius:12px; padding:16px; overflow:auto; }
article table { width:100%; border-collapse:collapse; margin:12px 0; }
article th, article td { border:1px solid var(--border); padding:8px; text-align:left; }
article th { background:var(--paper); }
article a { color:var(--accent); }
.muted { color:var(--text-muted); }`;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("style", { dangerouslySetInnerHTML: { __html: styles } }),
    React.createElement("div", { className: "container" },
      React.createElement("article", { dangerouslySetInnerHTML: { __html: rendered } })
    )
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