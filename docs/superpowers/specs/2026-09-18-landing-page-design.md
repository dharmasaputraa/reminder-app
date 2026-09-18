# wimember landing page (GitHub Pages) — design

Date: 2026-09-18
Status: approved (brainstorming), pending implementation

## Context

wimember's repo (`dharmasaputraa/reminder-app`) is public, but the project has no public
face: the SPA in `web/` is embedded into the Go binary and served behind Cloudflare
Access. This design adds a dedicated marketing landing page hosted on GitHub Pages to
attract users and contributors.

## Decisions

| Question | Decision |
| --- | --- |
| Purpose | Marketing for the project (self-hosted users + contributors) |
| Hosting | GitHub Pages, served from this same repo (public → free tier) |
| URL | `https://dharmasaputraa.github.io/reminder-app` (base path `/reminder-app/`) |
| Scope | Single page, anchor navigation only |
| Language | English |
| Stack | Vite + React 19 + Tailwind 4 in a new `site/` package — same toolchain as `web/` |
| Repo layout | Independent package with its own lockfile; **not** a pnpm workspace |

Rejected alternatives:

- **Astro** — would introduce a second framework into the repo while its main advantage
  (content collections) is unused on a single page. Worth revisiting only if the site
  grows a blog or docs.
- **Plain static `docs/` folder, no CI** — zero build but no component model; the
  hardest to keep visually consistent over time.
- **A landing route inside `web/`** — the SPA is embedded in the binary, private behind
  Cloudflare Access, and client-rendered (poor SEO/OG). Wrong home for a public page.

Why not a workspace: `Dockerfile` and `ci.yml` hardcode `web/` paths; converting to a
workspace risks the working pipeline for no real gain at this size. Two independent
lockfiles (`web/`, `site/`) is the deliberate trade-off.

## Architecture

```
site/
├── package.json        # vite, react, tailwind 4, motion, oxlint — same majors as web/
├── pnpm-lock.yaml      # own lockfile
├── vite.config.ts      # base: '/reminder-app/', plugins: react + tailwindcss
├── tsconfig.json
├── index.html          # SEO + Open Graph meta
├── public/             # favicon, og-image
└── src/
    ├── main.tsx
    ├── App.tsx         # composes sections; no router
    ├── sections/       # Nav, Hero, Features, Quickstart, Screenshot, Footer
    └── index.css       # Tailwind 4 + design tokens copied from web/src/index.css
```

- **No router.** Single page; navigation is anchor scrolling (`#features`, `#deploy`).
- **No data layer.** No React Query, no fetch, no API. All copy lives directly in
  components.
- **`web/` is untouched.** No change to the app binary, embed, or build.

## CI/CD (`.github/workflows/pages.yml`)

> Correction from the brainstorming session: the deploy branch is
> **`feature/reui-refactor`** (the repo's default branch per `origin/HEAD`), not `main`.

- **Triggers:** `pull_request` and `push` to `feature/reui-refactor`, both with
  `paths: ['site/**', '.github/workflows/pages.yml']`; plus `workflow_dispatch`.
- **Job `build`** (runs for PRs and pushes): checkout → pnpm (pin style matching
  `ci.yml`) → Node 22 with pnpm cache on `site/pnpm-lock.yaml` →
  `pnpm install --frozen-lockfile` → `pnpm build` → upload `site/dist` as a pages
  artifact. PR builds are the guard: a PR touching `site/` fails if the page breaks.
- **Job `deploy`** (push to `feature/reui-refactor` only): `actions/deploy-pages`,
  `permissions: pages: write, id-token: write`, own `concurrency` group.
- All actions pinned to commit SHAs, matching the existing workflows.
- **One-time manual step** (user): repo Settings → Pages → Source: **GitHub Actions**.
- `ci.yml` and `release.yml` are not modified — Pages has its own pipeline, separate
  from Go/web tests and image releases.

## Page content (single page, English)

1. **Nav** — wordmark "wimember", GitHub link, "Deploy" button → `#deploy`.
2. **Hero** — tagline: "Self-hosted reminders for Balinese otonan, birthdays &
   anniversaries". Subtext: the 210-day pawukon cycle computed automatically, delivered
   via Gotify, Telegram, or email — everything in one container. CTAs: GitHub repo and
   "Get started". Entrance animation via `motion`.
3. **Features grid** (6 cards, from the README): otonan & pawukon computation ·
   multi-channel notifications (Gotify, Telegram, SMTP) · never miss a reminder
   (catch-up + deduplication) · single-container self-hosted (SQLite + embedded SPA) ·
   encrypted channel configs (AES-256-GCM) · installable PWA.
4. **Quickstart** — the 3 deploy steps from the README (clone → `cp .env.example .env` →
   `compose up -d`), a Cloudflare Access note, link to the README for details.
5. **Screenshot** — app screenshot in a browser frame. Ships with a styled placeholder
   first; real screenshots follow as a small PR (asset from the author).
6. **Footer** — repo link, license, kalenderbali.org fixture attribution (per README),
   "built for the Balinese community".

## Visual design

- **Tokens:** copy `web/src/index.css` (shadcn-style CSS vars + `@theme inline`) so
  colors, radii, and fonts match the app. Light/dark both supported, defaulting to
  `prefers-color-scheme`.
- **Identity:** a subtle Balinese-inspired accent (geometric motif/gradient in the
  hero) — finalized visually during implementation.
- **Mobile-first**, one primary breakpoint.
- **SEO/OG:** `<title>`, meta description, Open Graph + Twitter card in `index.html`;
  favicon + og-image in `site/public/`. No sitemap (single page).

## Testing & verification

- `pages.yml` build job runs on every PR touching `site/**` — the main guard.
- Lint with `oxlint`, same as `web/`.
- No unit tests (no logic to test) and no Playwright e2e — the e2e suite stays focused
  on the app.
- Manual check before PR: `pnpm dev` and `pnpm preview` (with the base path).

## Implementation notes

- Work happens in the worktree `.worktrees/landing-page` on branch `feat/landing-page`,
  based off `feature/reui-refactor`. Baseline green: `make test` passes (all Go
  packages ok).
- PR target: `feature/reui-refactor`.
- Deploy goes live only after the one-time Settings → Pages change (user action).

## Open items

- Real app screenshots (author-provided) to replace the initial placeholder.
- Optional og-image design (can start as a screenshot crop).
