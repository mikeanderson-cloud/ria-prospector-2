# Agent context — ported from Claude Code plugins

Project: THE FOX — RIA prospecting web app
Ported: 2026-05-01

## What's in here

- `vercel/` — 25 Vercel skills (Next.js, shadcn, deployments, env vars,
  AI SDK, routing middleware, Turbopack, cache components, Vercel CLI,
  etc.) plus 3 agents (ai-architect, deployment-expert,
  performance-optimizer).
- `frontend-design/` — Distinctive frontend interface design skill
  (avoiding generic AI aesthetics).
- `feature-dev/` — Codebase-aware feature development agents
  (code-architect, code-explorer, code-reviewer).

## Most relevant for an RIA prospecting tool

- `vercel/skills/nextjs/` — App Router patterns (if Next.js)
- `vercel/skills/shadcn/` — Component composition for the prospecting UI
- `vercel/skills/ai-sdk/` and `vercel/skills/ai-gateway/` — If THE FOX
  uses AI for advisor research / data enrichment
- `vercel/skills/vercel-storage/` — For prospect / lead data storage
  (Postgres / KV / Blob)
- `vercel/skills/auth/` — Authentication patterns (Clerk, etc.) for
  whoever logs into the tool
- `vercel/skills/deployments-cicd/` and `env-vars/` — Standard Vercel
  hygiene
- `frontend-design/skills/frontend-design/` — Visual quality discipline
  for a customer-facing tool

## How to use in Antigravity

Load these as project context. The skill bodies are framework-agnostic
prose — they work as instructions to any capable agent.
