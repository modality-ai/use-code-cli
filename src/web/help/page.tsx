import React from "react";

export default function HelpPage() {
  return React.createElement(
    "div",
    null,
    React.createElement("h1", null, "use-code-cli server"),
    React.createElement("p", null, "Start with ", React.createElement("code", null, "bun start"), " (or ", React.createElement("code", null, "bun src/runner/server.ts"), ")."),
    React.createElement("p", null, "Port defaults to 3000; override with ", React.createElement("code", null, "PORT"), " env var."),
    React.createElement("h2", null, "Endpoints"),
    React.createElement("ul", null,
      React.createElement("li", null, React.createElement("code", null, "GET /sessions"), " - HTML list of all sessions"),
      React.createElement("li", null, React.createElement("code", null, "GET /design"), " - rendered design system"),
      React.createElement("li", null, React.createElement("code", null, "GET /help"), " - this page")
    ),
    React.createElement("h2", null, "Example"),
    React.createElement("pre", null, "curl http://127.0.0.1:3000/sessions")
  );
}