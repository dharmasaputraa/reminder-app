# wimember Landing Page (GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page marketing site for wimember in a new `site/` package and deploy it to GitHub Pages at `https://dharmasaputraa.github.io/reminder-app/`.

**Architecture:** A standalone Vite + React + Tailwind 4 package (`site/`, own lockfile, not a workspace) with no router and no data layer — copy lives in components. A dedicated `pages.yml` workflow builds on PRs and deploys `site/dist` to GitHub Pages on push to the mainline. Visual design follows the Linear style reference (dark-only, one acid-lime CTA).

**Tech Stack:** Vite 8, React 19, Tailwind 4 (`@theme` tokens), `motion` 13 (entrance animations), `@fontsource-variable/inter`, `lucide-react` (line icons), `oxlint`, pnpm 11, Node 22, GitHub Actions Pages deploy.

**Work location:** worktree `.worktrees/landing-page`, branch `feat/landing-page` (already created, based off `feature/reui-refactor`; Go baseline `make test` green). All paths below are relative to the worktree root.

**Spec:** `docs/superpowers/specs/2026-09-18-landing-page-design.md`
**Style tokens:** `docs/superpowers/specs/2026-09-18-linear-style-reference.md`

## Global Constraints

- Vite `base` is exactly `/reminder-app/` — every asset path must resolve under it.
- Dark-only. Canvas `#08090a`; no light theme, no `prefers-color-scheme` switch.
- Acid lime `#e4f222` is used by exactly ONE filled button per view: the hero "Get started" CTA. All other buttons are neutral (ghost or white pill).
- Font weights ≤ 590. Never `font-bold`/700+.
- Radius vocabulary: cards 12px, buttons/inputs 6px, pills 9999px. Nothing else.
- Elevation via hairline borders (`#23252a`) and inset shadows — no drop shadows on cards.
- Page max-width 1200px; section vertical gap 96px; nav is a fixed top bar.
- Display type tracking: `-0.022em` at ≥48px. Body 16px/1.5 in the grey scale (`#d0d6e0` / `#8a8f98` / `#62666d`).
- No router, no React Query, no fetch. Static copy only, in English.
- `web/`, `ci.yml`, `release.yml`, `Dockerfile` are NOT modified.
- Deploy branch is `feature/reui-refactor` (the repo mainline), NOT `main`.
- Commit style: conventional commits (`feat(site): …`, `ci: …`), matching repo history.

---

### Task 1: Scaffold the `site/` package that builds with the Pages base path

**Files:**
- Create: `site/package.json`
- Create: `site/vite.config.ts`
- Create: `site/tsconfig.json`
- Create: `site/index.html`
- Create: `site/src/main.tsx`
- Create: `site/src/App.tsx`
- Create: `site/src/index.css`
- Create: `site/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable package; `pnpm build` in `site/` emits `site/dist` with asset URLs prefixed `/reminder-app/`. `pnpm run dev` serves on Vite default port. Scripts: `dev`, `build`, `preview`, `lint`.

- [ ] **Step 1: Create `site/package.json`**

```json
{
  "name": "site",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@11.18.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "lint": "oxlint",
    "preview": "vite preview"
  },
  "dependencies": {
    "@fontsource-variable/inter": "^5.2.5",
    "lucide-react": "^1.45.0",
    "motion": "^13.2.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.7",
    "@vitejs/plugin-react": "^6.1.1",
    "oxlint": "^1.81.0",
    "tailwindcss": "^4.3.3",
    "typescript": "~6.0.2",
    "vite": "^8.3.0"
  }
}
```

- [ ] **Step 2: Create `site/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/reminder-app/",
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 3: Create `site/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `site/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>wimember — self-hosted otonan &amp; birthday reminders</title>
    <meta
      name="description"
      content="The 210-day pawukon cycle, birthdays and anniversaries — computed automatically and delivered via Gotify, Telegram, or email. One container, your server."
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `site/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create `site/src/App.tsx` (placeholder content for this task)**

```tsx
export default function App() {
  return <main className="min-h-screen bg-void text-mist">wimember</main>;
}
```

- [ ] **Step 7: Create `site/src/index.css` (minimal for this task; full tokens come in Task 2)**

```css
@import "tailwindcss";

body {
  background-color: #08090a;
  color: #d0d6e0;
}
```

- [ ] **Step 8: Create `site/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 9: Install and build**

Run: `cd site && pnpm install && pnpm build`
Expected: install succeeds, `tsc --noEmit` passes, Vite build emits `site/dist`. `dist/index.html` references assets under `/reminder-app/assets/`.

- [ ] **Step 10: Verify the base path in the built HTML**

Run: `grep -o '/reminder-app/assets/[^"]*' site/dist/index.html | head -3`
Expected: at least one match (the JS and CSS bundles).

- [ ] **Step 11: Commit**

```bash
git add site
git commit -m "feat(site): scaffold Vite + React package with Pages base path"
```

---

### Task 2: Linear design tokens and Inter Variable

**Files:**
- Modify: `site/src/index.css`

**Interfaces:**
- Consumes: `@fontsource-variable/inter` from Task 1's package.json.
- Produces: Tailwind utilities used by every later task — color classes (`bg-void`, `bg-carbon`, `bg-obsidian`, `border-graphite`, `border-smoke`, `text-ash`, `text-fog`, `text-mist`, `text-bone`, `text-paper`, `bg-acid-lime`, `text-void`), plus `shadow-card-inset`. Global body defaults: Inter Variable, `font-feature-settings "cv01" "ss03" "zero"`, dark canvas.

- [ ] **Step 1: Replace the contents of `site/src/index.css`**

```css
@import "tailwindcss";
@import "@fontsource-variable/inter";

@theme {
  /* Colors — Linear style reference */
  --color-void: #08090a;
  --color-carbon: #0f1011;
  --color-obsidian: #161718;
  --color-graphite: #23252a;
  --color-smoke: #383b3f;
  --color-ash: #62666d;
  --color-fog: #8a8f98;
  --color-mist: #d0d6e0;
  --color-bone: #e5e5e6;
  --color-paper: #ffffff;
  --color-acid-lime: #e4f222;

  /* Type — sizes and tracking from the reference scale */
  --text-caption: 13px;
  --leading-caption: 1.2;
  --text-body-sm: 15px;
  --leading-body-sm: 1.6;
  --text-body: 16px;
  --leading-body: 1.5;
  --text-body-lg: 20px;
  --leading-body-lg: 1.33;
  --text-subheading: 24px;
  --leading-subheading: 1.33;
  --text-heading-sm: 32px;
  --leading-heading-sm: 1.13;
  --text-heading: 48px;
  --leading-heading: 1;
  --text-heading-lg: 64px;
  --leading-heading-lg: 1;
  --text-display: 72px;
  --leading-display: 1;

  /* Fonts */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Radius vocabulary: 12 / 6 / pill only */
  --radius-sm: 2px;
  --radius-md: 6px;
  --radius-xl: 12px;

  /* Shadows — hairline inset is the card edge; no drop shadows on cards */
  --shadow-card-inset: rgb(35, 37, 42) 0px 0px 0px 1px inset;
  --shadow-subtle-card: rgba(0, 0, 0, 0.4) 0px 2px 4px 0px;
}

html {
  scroll-behavior: smooth;
  background-color: #08090a;
  color-scheme: dark;
}

body {
  font-family: var(--font-sans);
  font-feature-settings: "cv01", "ss03", "zero";
  background-color: #08090a;
  color: #d0d6e0;
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: rgba(228, 242, 34, 0.2);
}
```

- [ ] **Step 2: Build and lint**

Run: `cd site && pnpm build && pnpm lint`
Expected: both pass.

- [ ] **Step 3: Visual check**

Run: `cd site && pnpm dev`, open the printed URL.
Expected: black page (`#08090a`), the word "wimember" in Inter at `#d0d6e0`.

- [ ] **Step 4: Commit**

```bash
git add site/src/index.css site/pnpm-lock.yaml
git commit -m "feat(site): Linear style tokens and Inter Variable"
```

---

### Task 3: Layout and button primitives

**Files:**
- Create: `site/src/lib/cx.ts`
- Create: `site/src/components/Button.tsx`
- Create: `site/src/components/Section.tsx`
- Create: `site/src/components/ScreenshotFrame.tsx`

**Interfaces:**
- Consumes: color/radius/shadow utilities from Task 2.
- Produces (used by Tasks 4–9):
  - `cx(...parts: Array<string | false | null | undefined>): string` from `../lib/cx`
  - `<Button variant="primary" | "ghost" | "white-pill" {...AnchorHTMLAttributes<HTMLAnchorElement>} />`
  - `<Section id?: string>{children}</Section>` — 1200px max-width container with 96px vertical padding and `scroll-mt-24` for the fixed nav
  - `<ScreenshotFrame label: string />` — carbon browser-frame card for app screenshots (placeholder visuals until real ones land)

- [ ] **Step 1: Create `site/src/lib/cx.ts`**

```ts
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 2: Create `site/src/components/Button.tsx`**

```tsx
import type { AnchorHTMLAttributes } from "react";
import { cx } from "../lib/cx";

type Variant = "primary" | "ghost" | "white-pill";

const styles: Record<Variant, string> = {
  // The ONLY chromatic button — hero CTA (Global Constraints).
  primary:
    "bg-acid-lime text-void rounded-md px-4 py-2.5 text-[14px] font-[510] tracking-[-0.011em] hover:opacity-90",
  ghost:
    "border border-graphite text-mist rounded-md px-3 py-2 text-[13px] hover:border-smoke hover:text-bone",
  "white-pill":
    "bg-paper text-void rounded-full px-4 py-2 text-[13px] font-[510] hover:opacity-90",
};

export function Button({
  variant = "ghost",
  className,
  ...props
}: { variant?: Variant } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cx(
        "inline-flex items-center gap-2 transition-opacity duration-150",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Create `site/src/components/Section.tsx`**

```tsx
import type { ReactNode } from "react";

export function Section({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-6 py-[96px]"
    >
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Create `site/src/components/ScreenshotFrame.tsx`**

```tsx
export function ScreenshotFrame({ label }: { label: string }) {
  return (
    <div className="rounded-xl bg-carbon p-6 shadow-card-inset">
      <div className="flex items-center gap-1.5 pb-4">
        <span className="size-2.5 rounded-full bg-graphite" />
        <span className="size-2.5 rounded-full bg-graphite" />
        <span className="size-2.5 rounded-full bg-graphite" />
      </div>
      <div className="flex min-h-[280px] items-center justify-center rounded-md bg-obsidian px-6 py-16">
        <p className="text-caption text-fog">{label}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build and lint**

Run: `cd site && pnpm build && pnpm lint`
Expected: both pass (components are not yet imported; unused files are fine for oxlint — if it flags them, import them in `App.tsx` temporarily).

- [ ] **Step 6: Commit**

```bash
git add site/src
git commit -m "feat(site): section, button, and screenshot frame primitives"
```

---

### Task 4: Nav

**Files:**
- Create: `site/src/sections/Nav.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: `Button` (`white-pill`, `ghost`) from Task 3; anchor ids `#features`, `#deploy` (sections created in Tasks 6–7).
- Produces: the fixed top bar used by the final page.

- [ ] **Step 1: Create `site/src/sections/Nav.tsx`**

```tsx
import { Github } from "lucide-react";
import { Button } from "../components/Button";

const REPO = "https://github.com/dharmasaputraa/reminder-app";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-graphite bg-void/80 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-6">
        <a href="#top" className="text-[16px] font-[510] text-paper">
          wimember
        </a>
        <div className="flex items-center gap-2">
          <Button href="#features" className="border-0 px-3 py-2 hover:text-bone">
            Features
          </Button>
          <Button href="#deploy" className="border-0 px-3 py-2 hover:text-bone">
            Deploy
          </Button>
          <Button variant="white-pill" href={REPO}>
            <Github className="size-3.5" aria-hidden />
            GitHub
          </Button>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx`**

```tsx
import { Nav } from "./sections/Nav";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <p className="mx-auto max-w-[1200px] px-6 py-[96px] text-mist">
          wimember
        </p>
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: fixed dark nav with blur, white wordmark left, ghost links + white pill "GitHub" right; no acid lime anywhere.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): fixed top nav with GitHub pill CTA"
```

---

### Task 5: Hero

**Files:**
- Create: `site/src/sections/Hero.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: `Button` (`primary`, `ghost`), `ScreenshotFrame` from Task 3; `motion` from Task 1 deps.
- Produces: hero section with the single acid-lime CTA ("Get started" → `#deploy`) and the floating screenshot placeholder on a gradient floor.

- [ ] **Step 1: Create `site/src/sections/Hero.tsx`**

```tsx
import { motion } from "motion/react";
import { Button } from "../components/Button";
import { ScreenshotFrame } from "../components/ScreenshotFrame";

const REPO = "https://github.com/dharmasaputraa/reminder-app";

export function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-[1200px] px-6 pb-[96px] pt-[96px]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-[720px]"
      >
        <p className="mb-5 font-mono text-[12px] tracking-[-0.013em] text-fog">
          self-hosted · docker · single binary
        </p>
        <h1 className="text-[40px] font-[510] leading-none tracking-[-0.022em] text-paper md:text-[64px]">
          Self-hosted reminders for Balinese otonan, birthdays &amp;
          anniversaries
        </h1>
        <p className="mt-6 max-w-[560px] text-[16px] leading-[1.5] text-fog">
          The 210-day pawukon cycle computed automatically from each birth
          date, delivered via Gotify, Telegram, or email — everything in one
          container on your own server.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button variant="primary" href="#deploy">
            Get started
          </Button>
          <Button href={REPO}>View source</Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        className="relative mt-16"
      >
        {/* Hero gradient floor — the only gradient on the page */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(8,9,10,0)_10%,rgba(208,214,224,0.13)_100%)]"
        />
        <ScreenshotFrame label="wimember calendar — screenshot coming soon" />
      </motion.div>
    </section>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx`**

```tsx
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: headline fades up on load (64px on desktop, 40px mobile, tracking tight), ONE acid-lime "Get started" button, neutral "View source", screenshot placeholder on a faint light floor at the bottom.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): hero with single acid-lime CTA and screenshot floor"
```

---

### Task 6: Features

**Files:**
- Create: `site/src/sections/Features.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: `Section` from Task 3; `lucide-react` icons.
- Produces: section with `id="features"` (nav anchor target).

- [ ] **Step 1: Create `site/src/sections/Features.tsx`**

```tsx
import {
  Bell,
  CalendarSync,
  Fingerprint,
  History,
  MoonStar,
  Smartphone,
} from "lucide-react";
import { Section } from "../components/Section";

const FEATURES = [
  {
    icon: MoonStar,
    title: "Otonan & pawukon",
    body: "The 210-day cycle computed from each birth date, with saptawara, pancawara, and wuku labels — no calendar watching.",
  },
  {
    icon: Bell,
    title: "Every channel you run",
    body: "Gotify, Telegram, or email. Channel configs are encrypted with AES-256-GCM and testable with one click.",
  },
  {
    icon: History,
    title: "Never miss one",
    body: "Reminders missed while the container was down are caught up and labeled late; deduplication guarantees once per event, date, and offset.",
  },
  {
    icon: Fingerprint,
    title: "One container",
    body: "A single Go binary with the web UI embedded and SQLite on a volume. No external services required.",
  },
  {
    icon: CalendarSync,
    title: "More than otonan",
    body: "Birthdays (yes, Feb 29), anniversaries, and Pawukon holidays like Galungan, Kuningan, Saraswati, and Pagerwesi.",
  },
  {
    icon: Smartphone,
    title: "Installable PWA",
    body: "Add it to your phone's home screen; the calendar navigates across years with data fetched per range.",
  },
] as const;

export function Features() {
  return (
    <Section id="features">
      <h2 className="text-[32px] font-[510] leading-[1.13] tracking-[-0.022em] text-paper md:text-[48px] md:leading-none">
        Quietly keeps track
      </h2>
      <p className="mt-4 max-w-[560px] text-[16px] leading-[1.5] text-fog">
        Everything wimember does, it does on your own infrastructure.
      </p>
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <article
            key={title}
            className="rounded-md bg-[rgba(255,255,255,0.02)] p-6 shadow-subtle-card"
          >
            <Icon className="size-4 text-fog" aria-hidden />
            <h3 className="mt-4 text-[20px] font-[510] leading-[1.33] tracking-[-0.012em] text-mist">
              {title}
            </h3>
            <p className="mt-2 text-[15px] leading-[1.6] tracking-[-0.011em] text-fog">
              {body}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx`**

```tsx
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: 2-column grid on desktop (1 column on mobile), six quiet cards with hairline shadows, grey line icons — no colored accents. "Features" nav link scrolls here.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): features section, two-column quiet cards"
```

---

### Task 7: Quickstart (deploy steps)

**Files:**
- Create: `site/src/sections/Quickstart.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: `Section` from Task 3.
- Produces: section with `id="deploy"` (nav + hero CTA anchor target).

- [ ] **Step 1: Create `site/src/sections/Quickstart.tsx`**

```tsx
import { Section } from "../components/Section";

const STEPS: { prompt: string; command: string; comment?: string }[] = [
  {
    prompt: "$",
    command:
      "git clone https://github.com/dharmasaputraa/reminder-app.git wimember",
  },
  {
    prompt: "$",
    command: "cd wimember && cp .env.example .env",
    comment: "# set APP_SECRET, CF_ACCESS_*, ADMIN_EMAILS",
  },
  { prompt: "$", command: "docker compose up -d --build" },
];

export function Quickstart() {
  return (
    <Section id="deploy">
      <div className="grid grid-cols-1 items-start gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-[32px] font-[510] leading-[1.13] tracking-[-0.022em] text-paper md:text-[48px] md:leading-none">
            Running in three commands
          </h2>
          <p className="mt-4 text-[16px] leading-[1.5] text-fog">
            The SPA is embedded in the binary and SQLite lives on a volume.
            Public access goes through a Cloudflare tunnel with Cloudflare
            Access in front — no extra password to manage.
          </p>
          <a
            href="https://github.com/dharmasaputraa/reminder-app#readme"
            className="mt-6 inline-block text-[15px] text-mist underline decoration-graphite underline-offset-4 hover:text-bone"
          >
            Read the full setup guide in the README
          </a>
        </div>
        <div className="overflow-hidden rounded-xl bg-carbon shadow-card-inset">
          <div className="flex items-center gap-1.5 border-b border-graphite px-6 py-4">
            <span className="size-2.5 rounded-full bg-graphite" />
            <span className="size-2.5 rounded-full bg-graphite" />
            <span className="size-2.5 rounded-full bg-graphite" />
          </div>
          <ol className="px-6 py-5 font-mono text-[13px] leading-[1.71] tracking-[-0.013em]">
            {STEPS.map(({ prompt, command, comment }) => (
              <li key={command}>
                <span className="text-ash">{prompt} </span>
                <span className="text-mist">{command}</span>
                {comment ? <span className="text-ash"> {comment}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx`**

```tsx
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Quickstart } from "./sections/Quickstart";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
        <Quickstart />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: left column headline + Cloudflare note + README link; right terminal card with mono commands; "Get started" (hero) and "Deploy" (nav) scroll here.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): quickstart section with terminal card"
```

---

### Task 8: Product showcase band

**Files:**
- Create: `site/src/sections/Showcase.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: `ScreenshotFrame` from Task 3.
- Produces: full-bleed showcase band between Quickstart and Footer.

- [ ] **Step 1: Create `site/src/sections/Showcase.tsx`**

```tsx
import { ScreenshotFrame } from "../components/ScreenshotFrame";

export function Showcase() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-6 py-[96px]">
      <p className="mb-8 text-center text-caption text-fog">
        Your whole family's calendar — every otonan, birthday, and holiday in
        one place
      </p>
      <div className="mx-auto max-w-[1040px]">
        <ScreenshotFrame label="contacts & calendar — screenshot coming soon" />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx`**

```tsx
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Quickstart } from "./sections/Quickstart";
import { Showcase } from "./sections/Showcase";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
        <Quickstart />
        <Showcase />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: a wide centered screenshot placeholder card, caption above it, 96px spacing from neighbors.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): product showcase band"
```

---

### Task 9: Footer and final page assembly

**Files:**
- Create: `site/src/sections/Footer.tsx`
- Modify: `site/src/App.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the complete page — Nav, Hero, Features, Quickstart, Showcase, Footer.

Note: the repo has no LICENSE file — the footer must NOT claim a license.

- [ ] **Step 1: Create `site/src/sections/Footer.tsx`**

```tsx
const REPO = "https://github.com/dharmasaputraa/reminder-app";

export function Footer() {
  return (
    <footer className="border-t border-graphite">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-6 py-12 text-caption text-ash md:flex-row md:items-center md:justify-between">
        <p>
          Built for the Balinese community.{" "}
          <a
            href={REPO}
            className="text-fog underline decoration-graphite underline-offset-4 hover:text-mist"
          >
            View source on GitHub
          </a>
        </p>
        <p>
          Pawukon fixtures ©{" "}
          <a
            href="https://kalenderbali.org"
            className="text-fog underline decoration-graphite underline-offset-4 hover:text-mist"
          >
            kalenderbali.org
          </a>{" "}
          (I Wayan Nuarsa, Universitas Udayana) — personal test fixtures,
          not redistributed.
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Update `site/src/App.tsx` (final assembly)**

```tsx
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Quickstart } from "./sections/Quickstart";
import { Showcase } from "./sections/Showcase";
import { Footer } from "./sections/Footer";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
        <Quickstart />
        <Showcase />
      </main>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Build, lint, visual check**

Run: `cd site && pnpm build && pnpm lint && pnpm dev`
Expected: full single page in order; footer hairline top border, two lines (repo link / kalenderbali attribution); no license claim; every nav anchor reaches its section.

- [ ] **Step 4: Commit**

```bash
git add site/src
git commit -m "feat(site): footer with attribution, complete page assembly"
```

---

### Task 10: SEO, favicon, and preview verification under the base path

**Files:**
- Create: `site/public/favicon.svg`
- Modify: `site/index.html`

**Interfaces:**
- Consumes: final page from Task 9.
- Produces: complete meta set; favicon served from the Pages base path.

- [ ] **Step 1: Create `site/public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#08090a"/>
  <rect x="1" y="1" width="62" height="62" rx="11" fill="none" stroke="#23252a"/>
  <text x="32" y="43" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="510" fill="#e4f222" text-anchor="middle">w</text>
</svg>
```

- [ ] **Step 2: Add favicon and social meta to `site/index.html` `<head>`**

Add after the description meta (note: favicon href is relative so it resolves under `/reminder-app/`):

```html
<link rel="icon" type="image/svg+xml" href="favicon.svg" />
<meta property="og:title" content="wimember — self-hosted otonan &amp; birthday reminders" />
<meta
  property="og:description"
  content="The 210-day pawukon cycle, birthdays and anniversaries — computed automatically and delivered via Gotify, Telegram, or email. One container, your server."
/>
<meta property="og:type" content="website" />
<meta property="og:url" content="https://dharmasaputraa.github.io/reminder-app/" />
<meta name="twitter:card" content="summary" />
```

- [ ] **Step 3: Build and verify with preview under the base path**

Run: `cd site && pnpm build && pnpm preview`
Open the printed URL (it includes `/reminder-app/`).
Expected: page renders fully at `/reminder-app/` — CSS, JS, and favicon all load (no 404s in the network tab); title and OG tags present via "view source".

- [ ] **Step 4: Commit**

```bash
git add site/public/favicon.svg site/index.html
git commit -m "feat(site): SEO meta and favicon"
```

---

### Task 11: `pages.yml` deploy workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `site/` package from Tasks 1–10 (scripts `lint` and `build`, output `site/dist`).
- Produces: PR-time build validation + Pages deploy on push to `feature/reui-refactor`.

- [ ] **Step 1: Create `.github/workflows/pages.yml`**

```yaml
name: Pages

on:
  push:
    branches: [feature/reui-refactor]
    paths: ['site/**', '.github/workflows/pages.yml']
  pull_request:
    paths: ['site/**', '.github/workflows/pages.yml']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build landing page
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: pnpm/action-setup@d9184bf108216479bc5a137cc391f4d7b14c870b # v6.1.0
        with:
          package_json_file: site/package.json

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: site/pnpm-lock.yaml

      - name: Install deps
        working-directory: site
        run: pnpm install --frozen-lockfile

      - name: Lint
        working-directory: site
        run: pnpm run lint

      - name: Build
        working-directory: site
        run: pnpm run build

      - name: Upload pages artifact
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v3
        with:
          path: site/dist

  deploy:
    name: Deploy to GitHub Pages
    if: github.event_name != 'pull_request'
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

The checkout/pnpm/setup-node SHAs are copied verbatim from `ci.yml`. `upload-pages-artifact@v3` and `deploy-pages@v4` use version tags — before merging, optionally resolve and pin their SHAs to match the repo's pinning convention.

- [ ] **Step 2: Validate the workflow syntax**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Confirm `ci.yml` untouched**

Run: `git diff feature/reui-refactor -- .github/workflows/ci.yml .github/workflows/release.yml`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: pages workflow builds site on PRs and deploys to GitHub Pages"
```

---

### Task 12: Final verification, push, and PR

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1–11.

- [ ] **Step 1: Clean build from scratch**

Run: `cd site && rm -rf node_modules dist && pnpm install --frozen-lockfile && pnpm lint && pnpm build`
Expected: install, lint, and build all green.

- [ ] **Step 2: Confirm the repo footprint is contained**

Run (from worktree root): `git diff feature/reui-refactor --stat -- . ':!site' ':!.github/workflows/pages.yml' ':!docs'`
Expected: no output — nothing outside `site/`, the new workflow, and docs changed.

- [ ] **Step 3: Manual page walk-through**

Run: `cd site && pnpm dev`
Check: dark canvas everywhere; exactly ONE acid-lime button (hero); no bold weights; anchors Features/Deploy scroll correctly under the fixed nav; mobile width (DevTools ~390px) stacks all sections cleanly.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/landing-page
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create \
  --base feature/reui-refactor \
  --title "feat: wimember landing page on GitHub Pages" \
  --body "Single-page marketing site in a new site/ package (Vite + React + Tailwind 4, Linear style reference — dark-only, one acid-lime CTA). Deployed to GitHub Pages at https://dharmasaputraa.github.io/reminder-app/ via pages.yml. Spec: docs/superpowers/specs/2026-09-18-landing-page-design.md"
```

- [ ] **Step 6: Report the one-time manual step to the user**

The site goes live only after: repo **Settings → Pages → Source: GitHub Actions**. This is a user action — include it in the PR description or hand it to the user directly.

---

## Open items (post-merge, not in this plan)

- Real app screenshots replace the two placeholders (small follow-up PR; author provides PNGs).
- `og:image` (1200×630) — can start as a screenshot crop.
- Optionally pin `upload-pages-artifact` / `deploy-pages` to commit SHAs.
