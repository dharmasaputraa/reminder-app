# Refactoring otorem's UI to reUI (shadcn fallback) — Design

Date: 2026-09-13
Status: awaiting user review
Primary rule (user's wish): **use components from reUI; if none exists, take it from shadcn.**

## Decisions (confirmed with the user)

1. Pilot page: **Settings** (the simplest, 100% hand-rolled).
2. Work happens on a **new branch** `feature/reui-refactor` off HEAD of `feature/otorem-v1`.
3. **Full upgrade** of interaction patterns: native `confirm()` → AlertDialog, "active"
   checkbox → Switch, inline status `<p>` → toast (sonner).
4. **App shell: sidebar launcher + navbar** (confirmed via preview): the left sidebar
   holds the logo + **one** menu item "Autoreminder"; the four-page navigation stays as a
   horizontal navbar in the content header.
5. **Logo**: use `logo-w.svg` (abstract charcoal `#2A2A2A` mark) for the sidebar
   header — file provided by the user.
6. **Vision**: the application becomes a *personal self-app* for reminder/memory needs.
   Design consequence: the sidebar menu is **data-driven** (a single config array) so new
   modules only need a new entry; the new memory modules themselves are OUT OF SCOPE for
   this spec.

## Audit results (summary)

- Foundation: shadcn **base-nova** (Base UI) with a complete theme token set; 14 primitives in
  `src/components/ui/`; the Dashboard event calendar is already reUI (`c-event-calendar-3`,
  `@reui/event-calendar/*` primitives) — **untouched**.
- Problem: the `ui/` primitives are barely used by routes. The Dashboard only uses `button`+`tooltip`;
  Settings/Channels/Contacts (list & detail) are 100% native elements + ad-hoc Tailwind:
  native select/input/checkbox, browser `confirm()`, inline status `<p>`, cards and
  badges built from manual classes.
- `ui/` gaps (missing): `alert`, `alert-dialog`, `badge`, `checkbox`, `sonner`,
  `skeleton` — all available via free reUI.
- reUI catalog verified: 1,105 `c-*` examples across 74 categories, all installable
  without a license (HTTP 200 probe); premium blocks/icons/templates return 401.
- The `@reui` registry is already registered in `components.json`; the CLI is proven via shadcn
  3.8.5 (see SHADCN.md). Strategy: try CLI 4.21 first on the first install,
  fall back to 3.8.5 if it fails.
- No toaster provider (`sonner` not installed yet).

## App Shell — Sidebar (added after user direction)

Component source: **reUI has no sidebar family** (none of the 74 categories has
`sidebar`) → per the rule, fall back to **shadcn**: the `sidebar` block via
`npx shadcn add sidebar` (which also fills the `ui/sheet` + `ui/skeleton` gaps as
its dependencies). The reference code the user attached (achromatic pattern /
shadcn sidebar-07) is the shape to target; porting adapts it to the stack:

- **Next.js → Vite**: drop `'use client'`; `usePathname()` → TanStack Router
  (`useRouterState({ select: s => s.location.pathname })` + `Link`).
- **Tailwind v3 → v4**: no `tailwind.config.cjs` — the `sidebar` tokens are already
  available in the base-nova `index.css` (`--color-sidebar*` oklch) ✅; the
  `--sidebar-width`/`--sidebar-width-icon` variables are still set inline by
  `SidebarProvider` (style prop). Old arbitrary syntax `w-[--sidebar-width]`
  → `w-(--sidebar-width)`; `hsl(var(--…))` → `var(--…)` (tokens are full oklch now).
- `Slot` from the `radix-ui` package (already present); a small `useMediaQuery` hook written
  by hand in `src/hooks/`.
- Stored in `src/components/ui/sidebar.tsx`, with companion components
  (`AppSidebar`, menu config) in `src/components/`.

Final structure:

```
SidebarProvider
├─ Sidebar (collapsible=icon, open by default on desktop; Sheet below <lg)
│  ├─ SidebarHeader  : logo logo-w.svg + app name
│  └─ SidebarContent : 1 SidebarGroup "App"
│     └─ SidebarMenu : 1 item "Autoreminder" (Link → /)
│        (data-driven from NAV_CONFIG — future modules just add an entry)
└─ SidebarInset
   ├─ Header navbar : SidebarTrigger + horizontal navbar
   │                 (Dashboard · Kontak · Channel · Pengaturan — same content
   │                  as now, moved from the old __root, plus per-route
   │                  active state via TanStack `activeProps`)
   └─ <Outlet /> (page content, max-w container preserved)
```

- `__root.tsx` is rewritten as the shell above (the old nav + `max-w-2xl` wrapper
  move into `SidebarInset`/container).
- Logo: copy `logo-w.svg` → `web/src/assets/logo-w.svg`, imported in
  `SidebarHeader`; the favicon follows later (out of scope for this phase).
- Shell-specific verification: collapse/expand (Ctrl/Cmd+B), correct navbar active
  state per route, the Sheet version of the sidebar below the lg viewport, and no layout
  shift when navigating between pages.

## Requirements → source map

| Requirement (from the audit) | reUI (free) | shadcn fallback |
|---|---|---|
| Buttons | `c-button-*` | `ui/button` ✅ present |
| Select (+ timezone optgroup) | `c-select-*` | `ui/select` ✅ present |
| Text/number/password input | `c-input-*`, `c-input-group-*` | `ui/input`, `ui/field` ✅ present |
| Category checkboxes | `c-checkbox-*` | new (gap) |
| "Active" switch | `c-switch-*` | `ui/switch` ✅ present |
| Section/list cards | `c-card-*` | `ui/card` ✅ present |
| Badges (D-x, occasion type, status dot) | `c-badge-*`, `c-avatar-*` | new (gap) |
| Alert (warning/info banner) | `c-alert-*` | new (gap) |
| AlertDialog (replacing `confirm()`) | `c-alert-dialog-*` | new (gap) |
| Toast (saved/channel test/mutation error) | `c-sonner-*` | new (gap) |
| Skeleton/spinner (loading) | `c-skeleton-*`, `c-spinner-*` | new (gap) |
| Occasion date picker | `c-calendar-*` / `c-date-selector-*` | `ui/calendar` ✅ present |
| Small progress ring (pending) | `c-spinner-*` | new (gap) |

Principle for choosing examples: pick the `c-*` variant that is **closest to real usage**
on the page (not the one with the flashiest animation), because the c-* items automatically
bring the `@reui/*` + `ui/*` primitives they need (registryDependencies).

## Installation architecture

- Component source: the `@reui` registry (already configured, style `base-nova` →
  Base UI variants, matching the project stack).
- Install output: `c-*` examples → `src/components/examples/` (pattern references, not
  imported directly by routes when they are one-off examples); `@reui/*` primitives
  → `src/components/reui/*`; shadcn primitives → `src/components/ui/*`.
  Routes import **primitives** (reui/ui), not copies of example contents — examples are only
  composition guides. (Exception: when an example is itself a finished component used
  directly — e.g. a date picker — it may be imported as-is like the current event calendar.)
- `<Toaster />` (sonner) is mounted once in `__root.tsx`.
- New npm dependencies follow the examples' needs (e.g. `sonner`); validated
  via `tsc -b` at every phase.

## Execution phases (each ends with `npm run build` + visual browser verification)

- **Phase 0 — Foundation & branch**
  - Create the `feature/reui-refactor` branch.
  - Install the foundation examples: button, select, input(-group), checkbox, switch, card,
    badge, alert, alert-dialog, sonner, spinner (CLI 4.21 → fallback 3.8.5).
  - Mount `<Toaster />` in `__root.tsx`; green build as the baseline.
- **Phase 1 — App Shell (sidebar + navbar)**: `npx shadcn add sidebar` (brings
  `ui/sheet` + `ui/skeleton`), port to Vite/TanStack/v4 as described in the
  App Shell section above, logo into `SidebarHeader`, `__root.tsx` rewritten,
  horizontal navbar moved into the content header. All subsequent phases are verified
  inside this final shell.
- **Phase 2 — Settings (pilot)**: native select → `Select`, input → `Input`/
  `Field`, category checkbox → `Checkbox`, Save button → `Button` + "Saved." toast,
  mutation errors → destructive toast, cards → `Card`.
- **Phase 3 — Channels**: channel list → `Card` + status `Badge`; "active" →
  `Switch`; Test → outline `Button` + result toast; Delete → `AlertDialog` (replacing
  `confirm()`); add form → `Select` + `Input`/`InputGroup` (password) + `Button`;
  encryption note → info `Alert`.
- **Phase 4 — Contacts list + detail**: list → `Card` + initials `Avatar`; detail:
  occasion → type `Badge` + `Calendar`/date-picker; channel checkbox → `Checkbox`;
  preferences → `Switch`; delete contact/occasion → `AlertDialog`; feedback → toast.
- **Phase 5 — Dashboard polish**: empty-channel banner → `Alert`; upcoming list →
  `Card` + D-x `Badge` (colors via success/warning/destructive tokens); loading →
  `Skeleton`.
- **Phase 6 — Cleanup**: remove leftover ad-hoc classes, make sure no native
  `confirm()`/select/input remains in routes, `tsc -b` + production build green,
  visual verification of all pages.

## Per-phase verification

1. `npm run build` (tsc + vite) green.
2. Dev server + browser: the target page renders, the main flows work (save
   settings, toggle channel, add occasion), with no console errors.
3. `git status` clean of unexpected changes (guard as in the beUI trial).

## Risks & mitigation

- `c-*` examples bring their own styling → mitigation: choose plain variants, all colors
  via existing theme tokens (slate/indigo → primary/muted), visual testing per phase.
- CLI 4.21 vs registry → fallback to 3.8.5 (proven in SHADCN.md).
- Routes use react-query intensively → changes are purely presentational; mutation/query
  logic is untouched.

## Out of scope

- Event calendar (already reUI), backend/API, auth.
- Premium reUI components (paid blocks/icons/templates).
- New modules for the "memory self-app" vision (notes, habits, etc.) — this spec only
  prepares the shell so those modules are easy to add (data-driven NAV_CONFIG).
- Favicon/tab title change (pending a further branding decision).
