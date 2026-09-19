# Pado

- `PROJECT_BRIEF.md` is the product source of truth; preserve it. OLD is reference only.
- New implementation; do not copy Naru or sibling project source.
- Stack: React + TypeScript + Vite, Node HTTP + SSE, pnpm. One administrator-designated participation project; per-tab read-only browsing of others. Each project keeps its own resident TUI, files, conversations, panes and app runtime. Browsing/designation never restarts another project's runtime. Server-enforce inactive-project write denial, including administrator TUI/resize/Input/layout requests and app HTTP mutations/WebSockets.
- Internal file/read/edit events never automatically create File/Terminal panes. Terminal logs may also open for an actual managed command linked to the current native agent's verified wait state; background execution alone is insufficient. Internal/quiet commands and Input waits stay private. Explicit server startup logs remain visible. Only validated presentation/runtime events may create panes.
- The server owns speaker leases, turn lifecycle, roles and shared pane layout. Never trust browser roles or client IDs.
- Generated HTML belongs in an opaque-origin sandboxed iframe with restrictive CSP. Never render it in the parent DOM.
- Live server Browser panes use a separate gateway origin and sandboxed iframe; allow-same-origin is permitted only there, never for same-origin/srcdoc generated HTML. Proxy only approved ports of the managed app container, never arbitrary URLs. App containers have no agent/host credentials; explicitly named project secrets may be injected for a requested app/test. Do not forward Pado session cookies or expose the app's raw Docker ports on LAN.
- Project secrets use native Input, host-private plaintext storage and names-only agent replies. Never put their values in generated HTML, the agent bridge, shared snapshots or workspace files. This is a local demo convenience, not enforced secrecy from agent-written app code.
- Untrusted prompts must never execute on the host. Antigravity runs only in the dedicated Docker runner; rehearsal executes a fixed, non-user-controlled script.
- Never expose credentials, raw CLI diagnostics, or host paths to spectators. Public deployment requires its own readiness checks.
- Check `pnpm check` and `pnpm test:e2e`; verify desktop and mobile UI when changing it.
- GitHub agent is @hurdooagent; before a push, confirm agent-owned repo versus collaborator access to @hurdoo's repo. Do not record tokens. If denied, request collaborator invitation.
- Do not delete temporary files under /private/tmp; the user handles cleanup.
