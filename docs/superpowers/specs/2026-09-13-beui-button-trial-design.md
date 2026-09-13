# beUI Button Trial — Design

Date: 2026-09-13
Status: approved (user, conversation)

> **EPILOGUE (2026-09-13):** This trial turned out to be based on a misunderstanding — the
> component the user meant was **reUI** (reui.io), not beUI. All beUI files have been
> deleted and `motion` uninstalled (the tree was verified identical to HEAD). This spec
> is kept as a technical note: the beUI registry is not compatible with the shadcn CLI,
> and a manual install per beUI's `llms.txt` proved to work fully should it ever be
> needed.

## Goal

Test the integration of [beUI](https://beui.dev/) (animated React 19 + Tailwind v4 components,
shadcn-registry-style distribution, MIT license) into the `web/` frontend of the otorem project, by
installing **one trial component: `@beui/button`** (containing `Button`, `ButtonLink`,
`StatefulButton`, `MagneticButton`, `MetallicButton`).

Success criteria:

1. `npm run build` (tsc + vite) passes with no TS errors.
2. All four button variants render and their spring animations run in the browser, with no
   console errors.
3. No pre-existing project files change (in particular `src/components/ui/button.tsx`
   and `src/lib/utils.ts`).

## Context

- `web/` stack: React 19, Vite, Tailwind CSS v4, TanStack Router, shadcn CLI (style
  `base-nova`, Base UI/Radix components in `src/components/ui/`) — matches beUI's
  requirements.
- beUI provides a shadcn registry at `https://beui.dev/r/{name}` (JSON without an extension;
  `/{name}.json` returns 404).
- The `button` item writes to `components/motion/button/*` (it does NOT overwrite the
  built-in `components/ui/button.tsx`) plus helpers: `lib/ease.ts`,
  `lib/hooks/use-hover-capable.ts`, `lib/utils.ts`, `components/motion/magnetic.tsx`.
- Dependencies that would be added: `motion`, `clsx`, `tailwind-merge` (not yet present in
  the project).

## Chosen approach

**shadcn CLI with a registered registry** (not manual fetch, not a separate sandbox):

1. Add `"@beui": "https://beui.dev/r/{name}"` to `registries` in
   `web/components.json` (following the existing `@reui` pattern).
2. `npx shadcn add @beui/button` in `web/` — the CLI installs dependencies and writes
   files according to the paths in the JSON item.
3. Guard: check `git diff` on `src/lib/utils.ts`; if the CLI overwrites it, restore the
   old version (the project's built-in `cn` remains the source of truth; beUI's
   `@/lib/utils` imports still resolve to the same file).
4. Temporary demo: a temporary `/demo` route (not the index page, so it does not depend
   on the backend API) rendering all four button variants.
5. Verification: `npm run build` + visual check in the browser (Vite dev server, screenshots,
   console error check).
6. Cleanup: remove the demo route + regenerate `routeTree.gen.ts`; the registry config,
   dependencies, and component files **stay** for future use.

## Rollback

- File changes: `git checkout` / delete new files.
- Dependencies: `npm rm motion clsx tailwind-merge`.
- `components.json`: remove the `@beui` entry.

## Out of scope

- Using the button on real pages (pending a decision after the trial).
- Other beUI components (Toast Stack, etc.).
- beUI Pro tier (pro.beui.dev) — not used.

## Post-trial notes (execution results, 2026-09-13)

- The `@beui` registry turned out to be **incompatible with the shadcn CLI** (4.21.0 & 4.20.0):
  `https://beui.dev/r/{name}` returns beUI's custom format without `type: registry:*`,
  and `/{name}.json` 404s. According to their `llms.txt`, the official path is indeed manual
  placement by an agent. The `@beui` entry was not registered in `components.json` (cancelled).
- Manual install succeeded: 8 files from the JSON item were written (1 skipped: `lib/utils.ts` —
  the guard worked, the project file was untouched), the only new dep is `motion`.
- Verification: `npm run build` (tsc + vite) green; visually in the browser — 8 Button
  variants render with shadcn tokens, the StatefulButton cycle idle → loading → success → idle
  was demonstrated (click + screenshots); the Metallic shimmer and letter cascade work.
  Note: animated buttons make the Playwright actionability check time out — clicking needs
  a coordinate-based path; not a component defect.
- The `/demo` demo was removed and `routeTree.gen.ts` is identical again. Changes remaining in
  the tree (not committed): `src/components/motion/**`, `src/lib/ease.ts`,
  `src/lib/hooks/**`, `components/motion/magnetic.tsx`, `package.json`/lock (+motion),
  and the `web/SHADCN.md` note.
- Minor deviation from the original design: the demo used a separate `/demo` route (instead of
  a block on the index page) so verification did not depend on the backend API.
