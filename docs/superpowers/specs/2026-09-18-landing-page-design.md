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
| Visual style | Linear style reference — dark-only midnight theme, one acid-lime accent (appendix: `2026-09-18-linear-style-reference.md`) |

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
├── package.json        # vite, react, tailwind 4, motion, oxlint, @fontsource-variable/inter
├── pnpm-lock.yaml      # own lockfile
├── vite.config.ts      # base: '/reminder-app/', plugins: react + tailwindcss
├── tsconfig.json
├── index.html          # SEO + Open Graph meta
├── public/             # favicon, og-image
└── src/
    ├── main.tsx
    ├── App.tsx         # composes sections; no router
    ├── sections/       # Nav, Hero, Features, Quickstart, Screenshot, Footer
    └── index.css       # Tailwind 4 @theme — Linear style reference tokens (dark-only)
```

- **No router.** Single page; navigation is anchor scrolling (`#features`, `#deploy`).
- **No data layer.** No React Query, no fetch, no API. All copy lives directly in
  components.
- **Fonts:** Inter Variable self-hosted via `@fontsource-variable/inter`; mono text
  (quickstart code block) uses the `ui-monospace` stack — Berkeley Mono is licensed,
  and the reference itself lists system mono as the fallback.
- **`web/` is untouched.** No change to the app binary, embed, or build. The landing
  page has its own visual identity and does **not** reuse the app's shadcn tokens.

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

1. **Nav** — wordmark "wimember" left, ghost text links, white pill "GitHub" right
   (the high-contrast nav CTA in the Linear system).
2. **Hero** — oversized left-aligned headline (64–72px): "Self-hosted reminders for
   Balinese otonan, birthdays & anniversaries". Subtext: the 210-day pawukon cycle
   computed automatically, delivered via Gotify, Telegram, or email — everything in
   one container. **One** acid-lime CTA "Get started" → `#deploy` plus a ghost
   "View source" link. Beneath: the product screenshot floating on a subtle gradient
   floor (styled placeholder first; real screenshots follow as a small PR).
3. **Features** — the six README features (otonan & pawukon computation ·
   multi-channel notifications · catch-up + deduplication · single-container
   self-hosted · encrypted channel configs · installable PWA) as alternating
   text/visual rows or a 2-column composition. The style reference forbids dense
   3-column card grids; information density stays low with one focal point per
   screen.
4. **Quickstart** — the 3 deploy steps from the README (clone → `cp .env.example .env`
   → `compose up -d`) as a terminal-styled mono code block in a carbon card, a
   Cloudflare Access note, link to the README for details.
5. **Product showcase** — full-width app screenshot band (browser-frame card, hairline
   inset border).
6. **Footer** — repo link, license, kalenderbali.org fixture attribution (per README),
   "built for the Balinese community".

## Visual design — Linear style reference

The full token set lives in the appendix
(`2026-09-18-linear-style-reference.md`); the essentials:

- **Dark-only.** Near-black canvas `#08090a` (void), surfaces `#0f1011`/`#161718`,
  hairline borders `#23252a`. No light theme, no `prefers-color-scheme` switch.
- **Type:** Inter Variable, weights 300–590, never 700+. Display sizes at
  `-0.022em` tracking; body 16px/1.5 in the grey scale (`#d0d6e0`/`#8a8f98`/`#62666d`).
  `font-feature-settings: 'cv01' 'ss03' 'zero'` for the alternate glyphs.
- **One chromatic action per view.** Acid lime `#e4f222` only for the hero CTA; every
  other button is neutral (ghost/outline or white pill).
- **Shape vocabulary:** card radius 12px, buttons/inputs 6px, pills 9999px — nothing
  else. Elevation via hairline borders and inset shadows, not drop shadows.
- **Layout rhythm:** max-width 1200px, 96px section gaps, single focal point per
  screen, fixed top nav.
- **Imagery is product-screenshot-first** — the app UI is the only visual texture.
  No stock art, no abstract illustration, no decorative gradients outside the hero
  floor.
- The Balinese identity is carried by the copy and the real product screenshots, not
  by decorative chrome.
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
