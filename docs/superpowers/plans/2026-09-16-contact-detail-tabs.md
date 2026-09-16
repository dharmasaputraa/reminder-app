# Contact Detail Tabs + Occasion Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/reminder/contacts/$id` sections column into one Card with Occasions / Reminder Preferences tabs, where each occasion is a collapsed-by-default accordion item and the prefs form is rebuilt on Field primitives.

**Architecture:** Split the `page` variant out of `contact-detail-content.tsx` into four focused components (page shell, occasions tab, add-occasion form, prefs tab); the docked panel stays untouched in the original file. Three missing UI primitives (accordion, item, empty) are hand-written in the project's base-nova idiom.

**Tech Stack:** React 19, TanStack Router/Query, Base UI (`@base-ui/react`), Tailwind v4, reui/base-nova conventions (`cn` from `"cn"`, `data-slot` attributes, Base UI `render` prop), pnpm.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-contact-detail-tabs-design.md`.
- Branch: `feature/contact-detail-tabs` (already created; spec committed on it).
- **No test runner exists in `web/`** (scripts: `dev`/`build`/`lint`/`preview`). Per-task verification is `pnpm build` (runs `tsc -b`) and `pnpm lint` in `web/`, with the visual walkthrough in Task 7. Do not invent test infrastructure.
- The docked contact panel (`variant="docked"` behavior in `contact-detail-content.tsx`, used by `routes/reminder.contacts.index.tsx`) must render identically — do not restyle its sections.
- `OccasionPrefsEditor` (`web/src/components/contacts/occasion-prefs-editor.tsx`) is imported as-is; **zero edits to that file**.
- All occasions mutations keep their exact request bodies and invalidation sets (`contact`, `contacts`, `upcoming` prefix).
- Component conventions: `cn` imported from `"cn"`, `data-slot` attribute on every wrapper part, lucide icons named `*Icon`, Base UI `render` prop for element merging (the codebase does **not** use radix `Slot`).
- Spec deviation to implement in Task 1: the reui CLI route (`pnpm dlx shadcn@latest add @reui/c-accordion-6 …`) is **license-gated** for primitives (the free `c-*` demos only). Write the three primitives by hand on Base UI + upstream-shadcn adaptation (same exported names the design assumes), and amend the spec's section 5 accordingly.

---

### Task 1: UI primitives (accordion / item / empty) + shared date helpers

**Files:**
- Create: `web/src/components/ui/accordion.tsx`
- Create: `web/src/components/ui/item.tsx`
- Create: `web/src/components/ui/empty.tsx`
- Create: `web/src/lib/dates.ts`
- Modify: `docs/superpowers/specs/2026-09-16-contact-detail-tabs-design.md` (section 5)

**Interfaces:**
- Consumes: `@base-ui/react/accordion` (already in `@base-ui/react@1.8.0`), `lucide-react`, `cn` from `"cn"`, `date-fns`.
- Produces (later tasks import these exact names):
  - `Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionContent` from `@/components/ui/accordion`
  - `Item, ItemGroup, ItemSeparator, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions` from `@/components/ui/item`
  - `Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent` from `@/components/ui/empty`
  - `longDate(iso: string): string`, `shortDate(iso: string): string` from `@/lib/dates`

- [ ] **Step 1: Write `web/src/lib/dates.ts`**

```ts
import { format } from 'date-fns'

/** ISO yyyy-MM-dd → "Wednesday, 18 June 2003" (confirm dialogs, page rows). */
export function longDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEEE, d MMMM yyyy')
}

/** Compact variant for narrow rows: "Wed, 18 Jun 2003". */
export function shortDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'EEE, d MMM yyyy')
}
```

- [ ] **Step 2: Write `web/src/components/ui/accordion.tsx`**

```tsx
import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from 'cn'

function Accordion({
  className,
  // Base UI defaults to single-open; the spec wants multi-open rows.
  multiple = true,
  ...props
}: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('w-full', className)}
      multiple={multiple}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('group/accordion-item border-b last:border-b-0', className)}
      {...props}
    />
  )
}

function AccordionHeader({ className, ...props }: AccordionPrimitive.Header.Props) {
  return (
    <AccordionPrimitive.Header
      data-slot="accordion-header"
      className={cn('flex', className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn(
        'group/accordion-trigger flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]/accordion-trigger:rotate-180"
      />
    </AccordionPrimitive.Trigger>
  )
}

function AccordionContent({
  className,
  keepMounted = true,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      // Editors inside (e.g. OccasionPrefsEditor) keep uncontrolled inputs
      // alive while the row is collapsed.
      keepMounted={keepMounted}
      className={cn('text-sm', className)}
      {...props}
    />
  )
}

export { Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionContent }
```

- [ ] **Step 3: Write `web/src/components/ui/item.tsx`** (adapted from upstream shadcn `item`, `asChild` dropped — this codebase merges elements via Base UI `render` props, not radix `Slot`)

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Separator } from '@/components/ui/separator'

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn('group/item-group flex flex-col', className)}
      {...props}
    />
  )
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn('my-0', className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  'group/item flex flex-wrap items-center rounded-lg border border-transparent text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors duration-100',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-border',
        muted: 'bg-muted/50',
      },
      size: {
        default: 'gap-4 p-4',
        sm: 'gap-2.5 px-4 py-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Item({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return (
    <div
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(itemVariants({ variant, size, className }))}
      {...props}
    />
  )
}

const itemMediaVariants = cva(
  'flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: 'size-8 rounded-lg border bg-muted [&_svg:not([class*="size-"])]:size-4',
        image: 'size-10 overflow-hidden rounded-lg [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function ItemMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn('flex min-w-0 items-center gap-2 text-sm leading-snug font-medium', className)}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'text-muted-foreground line-clamp-2 text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-actions"
      className={cn('flex shrink-0 items-center gap-1', className)}
      {...props}
    />
  )
}

export {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
}
```

- [ ] **Step 4: Write `web/src/components/ui/empty.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg border-dashed p-6 text-center text-balance',
        className,
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex max-w-sm flex-col items-center gap-1.5 text-center', className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  'mb-1 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg:not([class*="size-"])]:size-5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="empty-title" className={cn('text-base font-medium tracking-tight', className)} {...props} />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-description"
      className={cn('text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary', className)}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn('flex w-full max-w-sm min-w-0 flex-col items-center gap-3 text-sm text-balance', className)}
      {...props}
    />
  )
}

export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent }
```

- [ ] **Step 5: Amend the spec's section 5** — replace the `pnpm dlx shadcn@latest add …` paragraph and the paragraph after it with:

```markdown
## 5. Component installs

The reui registry serves the `c-*` demos for free but license-gates the
underlying primitives, and tabs/switch/field already exist in this project as
the same base-nova versions. The three missing primitives are therefore written
by hand in the project idiom, keeping the exported names the design assumes:

- `ui/accordion.tsx` — wrapper over `@base-ui/react/accordion` (Root, Item,
  Header, Trigger with rotating chevron, Panel with `keepMounted` default so
  collapsed editors keep their uncontrolled inputs).
- `ui/item.tsx` — adapted from upstream shadcn `item` (MIT), `asChild` dropped
  (this codebase merges elements via Base UI `render` props).
- `ui/empty.tsx` — adapted from upstream shadcn `empty` (MIT).

`reui/badge` is not needed — the project's `ui/badge.tsx` already covers the
variants used.
```

- [ ] **Step 6: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: tsc reports no errors (new files are unused but must type-check), oxlint clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/lib/dates.ts web/src/components/ui/accordion.tsx web/src/components/ui/item.tsx web/src/components/ui/empty.tsx docs/superpowers/specs/2026-09-16-contact-detail-tabs-design.md
git commit -m "feat(web): accordion/item/empty primitives + shared date helpers"
```

---

### Task 2: AddOccasionForm component

**Files:**
- Create: `web/src/components/contacts/add-occasion-form.tsx`

**Interfaces:**
- Consumes: `api` from `@/lib/api`; `DateSelectorPopover`, `dateSelectorValueToDate` from `@/components/date-selector-popover`; `DateSelectorValue` type from `@/components/reui/date-selector`; ui primitives (`Select` family, `Input`, `Button`).
- Produces: `AddOccasionForm({ contactId }: { contactId: string })` — fully self-contained; renders `null` never (parent conditionally mounts). On success it resets its own fields and invalidates `['contact', contactId]`, `['contacts']`, `['upcoming']`.

- [ ] **Step 1: Write the file** — this is the current add-form logic moved out of `contact-detail-content.tsx` (its lines 45–68 constants and 119–200 state/effects/mutation and 535–633 JSX), with only the container changed to a boxed panel:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Occasion } from '@/lib/api'
import { DateSelectorPopover, dateSelectorValueToDate } from '@/components/date-selector-popover'
import type { DateSelectorValue } from '@/components/reui/date-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Occasion type control: the three built-ins plus a free-text "Custom…"
 *  (suggestions for it come from GET /occasions/types). */
const TYPE_ITEMS: { value: string; label: string }[] = [
  { value: 'otonan', label: 'Otonan (210-day Pawukon)' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'custom', label: 'Custom…' },
]

/** The recurrence a built-in type implies. "Custom…" has no entry — it keeps
 *  the user's current choice (untouched → yearly). */
const TYPE_RECURRENCE: Record<string, Occasion['recurrence']> = {
  otonan: 'otonan',
  birthday: 'yearly',
  anniversary: 'anniversary',
}

const RECURRENCE_ITEMS: { value: Occasion['recurrence']; label: string }[] = [
  { value: 'once', label: 'One-time' },
  { value: 'yearly', label: 'Every year' },
  { value: 'monthly', label: 'Every month' },
  { value: 'anniversary', label: 'Every year + every month' },
  { value: 'otonan', label: 'Otonan (every 210 days)' },
]

/** The add-an-occasion form, revealed by a toggle in OccasionsTab. Same
 *  fields and behavior as the original bottom-of-card section; the form stays
 *  open after an add (fields reset) so several can be entered in a row. */
export function AddOccasionForm({ contactId }: { contactId: string }) {
  const qc = useQueryClient()
  const [type, setType] = useState('otonan') // built-in value or 'custom'
  const [customType, setCustomType] = useState('') // free text when type === 'custom'
  const [recurrence, setRecurrence] = useState<Occasion['recurrence']>('yearly')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [dateSel, setDateSel] = useState<DateSelectorValue | undefined>(undefined)
  const [pawukon, setPawukon] = useState('')

  const custom = type === 'custom'
  const effectiveType = custom ? customType.trim() : type

  // Built-in types imply their recurrence (birthday → yearly, otonan →
  // otonan, anniversary → anniversary); "Custom…" leaves the current pick.
  useEffect(() => {
    const auto = TYPE_RECURRENCE[type]
    if (auto) setRecurrence(auto)
  }, [type])

  // Custom-type suggestions: the caller's own previously used types (the
  // built-ins already have select options), fetched only while custom.
  const occasionTypes = useQuery({
    queryKey: ['occasion-types'],
    queryFn: () => api<{ types: string[] }>('/occasions/types'),
    enabled: custom,
  })
  const typeSuggestions = [...new Set(occasionTypes.data?.types ?? [])].filter(
    (t) => !TYPE_ITEMS.some((i) => i.value === t),
  )

  // Pawukon preview for otonan recurrences — recomputed when the date or the
  // recurrence changes, so switching a picked date to otonan updates it.
  useEffect(() => {
    setPawukon('')
    if (!date || recurrence !== 'otonan') return
    let alive = true
    api<{ label: string }>(`/pawukon?date=${date}`)
      .then((r) => {
        if (alive) setPawukon(r.label)
      })
      .catch(() => {
        /* stay silent */
      })
    return () => {
      alive = false
    }
  }, [date, recurrence])

  const addOcc = useMutation({
    mutationFn: () =>
      api(`/contacts/${contactId}/occasions`, {
        method: 'POST',
        body: JSON.stringify({ type: effectiveType, recurrence, date, label: label.trim() }),
      }),
    onSuccess: () => {
      setDate('')
      setDateSel(undefined)
      setPawukon('')
      setLabel('')
      setCustomType('')
      qc.invalidateQueries({ queryKey: ['contact', contactId] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to add occasion: ${String(e)}`),
  })

  // flex-wrap: the w-56 controls share the row only when there is room and
  // stack on narrow viewports. Custom types reveal a free-text input in place,
  // with the previously used types as clickable suggestion chips underneath.
  return (
    <div className="space-y-2 rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={TYPE_ITEMS}
          value={type}
          onValueChange={(v) => {
            if (!v) return
            // "Custom…" falls back to yearly while the recurrence is still
            // the previous type's default — a manual pick is kept.
            if (v === 'custom' && recurrence === TYPE_RECURRENCE[type]) setRecurrence('yearly')
            setType(v)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Occasion type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {TYPE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {custom && (
          <Input
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            placeholder="Custom type, e.g. graduation"
            aria-label="Custom occasion type"
            className="w-56"
          />
        )}
        <Select
          items={RECURRENCE_ITEMS}
          value={recurrence}
          onValueChange={(v) => {
            if (!v) return
            setRecurrence(v)
          }}
        >
          <SelectTrigger className="w-52" aria-label="Recurrence">
            <SelectValue placeholder="Recurrence" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {RECURRENCE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DateSelectorPopover
          value={dateSel}
          onApply={(v) => {
            setDateSel(v)
            const d = dateSelectorValueToDate(v)
            setDate(d ? format(d, 'yyyy-MM-dd') : '')
          }}
          placeholder="Pick a date"
          minYear={1800}
          maxYear={new Date().getFullYear() + 10}
          weekStartsOn={1}
          allowRange={false}
          periodTypes={['day', 'month', 'year']}
          monthCascadesToDay
          showFilterTypes={false}
          className="w-56 justify-start"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Occasion label"
          className="w-44"
        />
        <Button disabled={!date || !effectiveType || addOcc.isPending} onClick={() => addOcc.mutate()}>
          Add
        </Button>
      </div>
      {custom && typeSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Previously used:</span>
          {typeSuggestions.map((t) => (
            <Button key={t} type="button" variant="outline" size="xs" onClick={() => setCustomType(t)}>
              {t}
            </Button>
          ))}
        </div>
      )}
      {pawukon && <p className="text-sm text-emerald-700 dark:text-emerald-400">{pawukon}</p>}
      {effectiveType === 'birthday' && date.endsWith('-02-29') && (
        <p className="text-muted-foreground text-xs">Feb 29 in non-leap years is observed on March 1.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: clean (file is unused but must type-check).

- [ ] **Step 3: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/components/contacts/add-occasion-form.tsx
git commit -m "feat(web): extract add-occasion form component"
```

---

### Task 3: ReminderPrefsTab component

**Files:**
- Create: `web/src/components/contacts/reminder-prefs-tab.tsx`
- Modify: `web/src/lib/prefs.ts` (append two copy helpers)

**Interfaces:**
- Consumes: `Contact`, `Channel`, `Settings`, `api` from `@/lib/api`; `hydratePrefsForm`, `parseList` from `@/lib/prefs`; ui `Field` family (already exists at `@/components/ui/field`), `Input`, `Switch`, `Checkbox`, `Button`, `Label`.
- Produces:
  - `defaultSummary(settings?: Settings): string` and `offsetsSummary(list?: number[]): string` exported from `@/lib/prefs` (Task 6 also imports `defaultSummary` from there after deleting the copies in `contact-detail-content.tsx`).
  - `ReminderPrefsTab({ contact, channels, settings }: { contact: Contact; channels: Channel[]; settings?: Settings })`.

- [ ] **Step 1: Append to `web/src/lib/prefs.ts`**

```ts
import type { Settings } from '@/lib/api'

/** "[30, 7, 0]" → "D-30, D-7, on the day" — the copy form for offset lists. */
export function offsetsSummary(list?: number[]): string {
  return (list ?? []).map((n) => (n === 0 ? 'on the day' : `D-${n}`)).join(', ')
}

/** The per-recurrence default sets the contact form edits, as copy:
 *  "Yearly: D-30, D-7, … · Monthly: on the day". */
export function defaultSummary(settings?: Settings): string {
  return (
    `Yearly: ${offsetsSummary(settings?.recurrence_offsets?.yearly)} · ` +
    `Monthly: ${offsetsSummary(settings?.recurrence_offsets?.monthly)}`
  )
}
```

(Place the `Settings` import with the file's existing imports at the top, not mid-file; merge with any existing type imports.)

- [ ] **Step 2: Write the component** — behavior identical to today's Reminder Preferences card, layout on Field primitives:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type Channel, type Contact, type Settings } from '@/lib/api'
import { defaultSummary, hydratePrefsForm, parseList } from '@/lib/prefs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

/** The contact-level reminder defaults: per-stream offsets, active switch,
 *  channels. Same mutations and save semantics as the original card — only
 *  the layout moved to Field primitives. Channel chips save immediately;
 *  offsets + active save via the footer button (non-lossy offsets spread). */
export function ReminderPrefsTab({
  contact,
  channels,
  settings,
}: {
  contact: Contact
  channels: Channel[]
  settings?: Settings
}) {
  const qc = useQueryClient()
  const [yearly, setYearly] = useState('')
  const [monthly, setMonthly] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const form = hydratePrefsForm(contact.prefs)
    setYearly(form.yearly)
    setMonthly(form.monthly)
    setEnabled(form.enabled)
  }, [contact.prefs])

  const savePrefs = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/contacts/${contact.id}/prefs`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to save preferences: ${String(e)}`),
  })

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Global defaults — {defaultSummary(settings)} · send time {settings?.send_time}
      </p>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
          <Field>
            <FieldLabel htmlFor="pref-yearly-offsets">Yearly offsets</FieldLabel>
            <Input
              id="pref-yearly-offsets"
              value={yearly}
              onChange={(e) => setYearly(e.target.value)}
              placeholder="e.g. 30, 7, 0"
              className="w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pref-monthly-offsets">Monthly offsets</FieldLabel>
            <Input
              id="pref-monthly-offsets"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="e.g. 1, 0"
              className="w-full"
            />
          </Field>
        </div>
        <FieldDescription>Days before the occasion. Empty uses the global default for that stream.</FieldDescription>
        <Separator />
        {/* Switch-in-frame row: label + description left, control right. */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="pref-active">Active</FieldLabel>
            <FieldDescription>Paused contacts get no notifications at all.</FieldDescription>
          </FieldContent>
          <Switch
            id="pref-active"
            checked={enabled}
            onCheckedChange={(v) => setEnabled(v === true)}
          />
        </Field>
        <Separator />
        <Field>
          <FieldLabel>Channels</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {channels.map((ch) => (
              <label key={ch.id} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-sm">
                <Checkbox
                  defaultChecked={contact.prefs?.channel_ids.includes(ch.id) ?? false}
                  onCheckedChange={(v) => {
                    const cur = new Set(contact.prefs?.channel_ids ?? [])
                    if (v === true) cur.add(ch.id)
                    else cur.delete(ch.id)
                    savePrefs.mutate({ channel_ids: [...cur] })
                  }}
                />
                {ch.name} ({ch.type})
              </label>
            ))}
          </div>
          <FieldDescription>
            Changes save automatically — no selection uses the system default channels.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button
          onClick={() =>
            savePrefs.mutate({
              // Non-lossy: only the two edited lists change, any other stream
              // the contact has an override for is preserved.
              offsets: { ...(contact.prefs?.offsets ?? {}), yearly: parseList(yearly), monthly: parseList(monthly) },
              enabled,
            })
          }
        >
          Save preferences
        </Button>
      </div>
    </div>
  )
}
```

Notes for the implementer:
- The `useEffect` dependency is `contact.prefs` (the object), matching the original hydration effect's intent (re-hydrate when a refetch lands).

- [ ] **Step 3: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/components/contacts/reminder-prefs-tab.tsx web/src/lib/prefs.ts
git commit -m "feat(web): reminder preferences tab on field primitives"
```

---

### Task 4: OccasionsTab component (empty state, add toggle, accordion)

**Files:**
- Create: `web/src/components/contacts/occasions-tab.tsx`

**Interfaces:**
- Consumes: `Contact`, `Channel`, `api` from `@/lib/api`; `shortDate`, `longDate` from `@/lib/dates`; `useUpcomingByOccasion` from `@/components/contacts/contacts-grid`; `OccasionPrefsEditor` from `@/components/contacts/occasion-prefs-editor`; `AddOccasionForm` from Task 2; `ReminderTrigger` from `@/components/event-detail`; accordion + item + empty primitives from Task 1; `AlertDialog` family, `Badge`, `Button`.
- Produces: `OccasionsTab({ contact, channels }: { contact: Contact; channels: Channel[] })`. Owns the delete mutation (invalidates `['contact', contact.id]`, `['contacts']`, `['upcoming']`).

- [ ] **Step 1: Write the file**

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDaysIcon,
  CakeIcon,
  HeartIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { api, type Channel, type Contact, type Occasion } from '@/lib/api'
import { longDate, shortDate } from '@/lib/dates'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { AddOccasionForm } from '@/components/contacts/add-occasion-form'
import { OccasionPrefsEditor } from '@/components/contacts/occasion-prefs-editor'
import { ReminderTrigger } from '@/components/event-detail'
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'

/** Per-type icon tiles; custom/unknown types fall back to a plain calendar. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  birthday: CakeIcon,
  anniversary: HeartIcon,
  otonan: SparklesIcon,
}

/** Recurrence as human copy for the collapsed row's description line. */
const RECURRENCE_COPY: Record<Occasion['recurrence'], string> = {
  once: 'one-time',
  yearly: 'every year',
  monthly: 'every month',
  anniversary: 'every year + every month',
  otonan: 'every 210 days (Otonan)',
}

/** The occasions list: date-ordered accordion items (collapsed by default),
 *  an add-form toggle, and the empty state. Delete + Remind-now stay on the
 *  collapsed row, OUTSIDE the accordion trigger so buttons are never nested.
 *  The per-occasion reminder editor (OccasionPrefsEditor) only renders in the
 *  expanded content — inherit occasions stay visually quiet. */
export function OccasionsTab({ contact, channels }: { contact: Contact; channels: Channel[] }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  // Countdown per occasion — shares the grid's ['upcoming','grid'] query, no
  // extra fetch.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  const delOcc = useMutation({
    mutationFn: (oid: string) => api(`/occasions/${oid}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contact.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
    onError: (e) => toast.error(`Failed to delete occasion: ${String(e)}`),
  })

  if (contact.occasions.length === 0 && !adding) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDaysIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No occasions yet</EmptyTitle>
          <EmptyDescription>
            Add a birthday, anniversary, or any recurring date to start getting reminders.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add occasion
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add occasion
        </Button>
      </div>
      {adding && <AddOccasionForm contactId={contact.id} />}

      <Accordion>
        {contact.occasions.map((o) => {
          const up = upcomingByOccasion.get(o.id)
          const TypeIcon = TYPE_ICONS[o.type] ?? CalendarDaysIcon
          return (
            <AccordionItem key={o.id} value={o.id}>
              <AccordionHeader className="items-center gap-1 pr-2">
                <AccordionTrigger className="min-w-0">
                  <ItemMedia variant="icon" className="size-8 rounded-lg">
                    <TypeIcon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate capitalize">
                      {o.type}
                      {o.label && (
                        <span className="text-muted-foreground font-normal"> · {o.label}</span>
                      )}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {shortDate(o.base_date)} · {RECURRENCE_COPY[o.recurrence]}
                    </ItemDescription>
                  </ItemContent>
                  <span className="flex shrink-0 items-center gap-1">
                    {o.prefs && <Badge variant="outline">Custom</Badge>}
                    {o.prefs?.enabled === false && <Badge variant="warning-outline">Paused</Badge>}
                    {up && (
                      <Badge variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'} className="shrink-0">
                        {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <ItemActions>
                  {/* Remind needs an actual occurrence date: the backend
                      matches `date` exactly, and a base date is not an
                      occurrence for otonan (base+210n). */}
                  {up && (
                    <ReminderTrigger
                      kind="occasion"
                      occasionId={o.id}
                      contactId={contact.id}
                      date={up.date}
                      title={`${contact.name}'s ${o.type}`}
                      variant="ghost"
                      compact
                      className="size-7 justify-center px-0 text-muted-foreground hover:text-foreground"
                    />
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${o.type} occasion`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this occasion?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {o.type} on {longDate(o.base_date)} will be permanently deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => delOcc.mutate(o.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </ItemActions>
              </AccordionHeader>
              <AccordionContent className="pb-3">
                <OccasionPrefsEditor contactId={contact.id} occasion={o} channels={channels} />
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
```

- [ ] **Step 2: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: clean (file is unused but must type-check). If `LucideIcon` is not exported as a type from `lucide-react@1.45`, use `React.ComponentType<{ className?: string }>` instead.

- [ ] **Step 3: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/components/contacts/occasions-tab.tsx
git commit -m "feat(web): occasions tab with accordion rows and empty state"
```

---

### Task 5: ContactDetailPageContent (queries + Card + Tabs shell)

**Files:**
- Create: `web/src/components/contacts/contact-detail-page-content.tsx`

**Interfaces:**
- Consumes: all three tabs from Tasks 2–4; queries (`['contact', id]`, `['channels']`, `['settings']`); `useIsLg` NOT needed here (the edit overlay stays in the route file).
- Produces: `ContactDetailPageContent({ contactId }: { contactId: string })` — Task 6 wires it into the route.

- [ ] **Step 1: Write the file**

```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CalendarDaysIcon, SlidersHorizontalIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { OccasionsTab } from '@/components/contacts/occasions-tab'
import { ReminderPrefsTab } from '@/components/contacts/reminder-prefs-tab'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** The /reminder/contacts/$id sections column: one Card, two tabs. Owns the
 *  contact/channels/settings queries (shared cache with the summary card and
 *  the docked panel) and the loading/error states; the tabs own their
 *  mutations. Both panels stay mounted (keepMounted) so a half-typed form
 *  survives switching tabs. */
export function ContactDetailPageContent({ contactId }: { contactId: string }) {
  const nav = useNavigate()
  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => api<Contact>(`/contacts/${contactId}`),
  })
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api<{ channels: Channel[] }>('/channels') })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') })

  if (contact.isLoading) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="px-4 pt-4">
          <Skeleton className="h-7 w-64" />
        </div>
        <div className="space-y-2.5 px-4 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  }
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = contact.data!
  const channelList = channels.data?.channels ?? []

  return (
    <Card>
      <Tabs defaultValue="occasions">
        <div className="border-b px-4 pt-3 pb-2">
          <TabsList>
            <TabsTrigger value="occasions">
              <CalendarDaysIcon data-icon="inline-start" aria-hidden="true" />
              Occasions ({c.occasions.length})
            </TabsTrigger>
            <TabsTrigger value="prefs">
              <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
              Reminder Preferences
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="occasions" keepMounted className="p-4">
          <OccasionsTab contact={c} channels={channelList} />
        </TabsContent>
        <TabsContent value="prefs" keepMounted className="p-4">
          <ReminderPrefsTab contact={c} channels={channelList} settings={settings.data} />
        </TabsContent>
      </Tabs>
    </Card>
  )
}
```

Notes for the implementer:
- None — the snippet compiles as written; keep the `keepMounted` props on both `TabsContent` panels.

- [ ] **Step 2: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/components/contacts/contact-detail-page-content.tsx
git commit -m "feat(web): contact detail page shell with occasions/prefs tabs"
```

---

### Task 6: Rewire route + slim contact-detail-content to docked-only

**Files:**
- Modify: `web/src/routes/reminder.contacts.$id.tsx:7` (import) and `:78` (usage)
- Modify: `web/src/components/contacts/contact-detail-content.tsx` (remove page variant)
- Modify: `web/src/routes/reminder.contacts.index.tsx:150` (drop `variant` prop)

**Interfaces:**
- Consumes: `ContactDetailPageContent` from Task 5; `shortDate` + `defaultSummary` from `@/lib/dates` / `@/lib/prefs`.
- Produces: `ContactDetailContent({ contactId }: { contactId: string })` — docked-only, no `variant` prop.

- [ ] **Step 1: Update the route file** — replace the `ContactDetailContent` import and usage:

```tsx
import { ContactDetailPageContent } from '@/components/contacts/contact-detail-page-content'
```

and in `ContactDetailPage`:

```tsx
<ContactDetailPageContent contactId={id} />
```

- [ ] **Step 2: Update the index route call site** (`web/src/routes/reminder.contacts.index.tsx:150`):

```tsx
<ContactDetailContent contactId={panelC} />
```

- [ ] **Step 3: Replace `contact-detail-content.tsx`** with the docked-only file. Full content:

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRightIcon, Maximize2Icon, XIcon } from 'lucide-react'
import { ApiError, api, type Channel, type Contact, type Settings } from '@/lib/api'
import { defaultSummary } from '@/lib/prefs'
import { shortDate } from '@/lib/dates'
import { initials } from '@/lib/initials'
import { useUpcomingByOccasion } from '@/components/contacts/contacts-grid'
import { DetailRow, PanelSection } from '@/components/panel-section'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** Read-only contact panel docked beside the contacts grid (agenda-panel
 *  detail layer). Identity + notes + the occasions cap-3 preview + the
 *  reminders summary; editing lives on /reminder/contacts/$id, whose sections
 *  column is ContactDetailPageContent. */
export function ContactDetailContent({ contactId }: { contactId: string }) {
  const id = contactId
  const nav = useNavigate()

  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
  })
  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api<{ channels: Channel[] }>('/channels'),
  })
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/settings'),
  })
  // Countdown per occasion — shares the grid's ['upcoming','grid'] query.
  const { map: upcomingByOccasion } = useUpcomingByOccasion()

  if (contact.isLoading)
    return (
      <div>
        <div className="flex flex-col items-center gap-2 px-4 pt-8">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-6 space-y-2.5 border-t px-4 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  if (contact.isError) {
    const notFound = contact.error instanceof ApiError && contact.error.status === 404
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">{notFound ? 'Contact not found' : 'Failed to load contact'}</p>
        {!notFound && <p className="text-sm text-red-600">{String(contact.error)}</p>}
        <Button variant="outline" size="sm" onClick={() => nav({ to: '/reminder/contacts' })}>
          Back to contacts
        </Button>
      </div>
    )
  }
  const c = contact.data!

  /** Identity block: avatar above the name (+ nickname) — the centered
   *  profile header. */
  const identityBlock = (
    <div className="flex flex-col items-center gap-2 px-4 pb-5 pt-6 text-center">
      <Avatar className="size-16">
        <AvatarFallback className="text-lg">{initials(c.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <h1 className="text-pretty text-lg leading-snug font-semibold">{c.name}</h1>
        {c.nickname && <p className="text-muted-foreground text-sm">{c.nickname}</p>}
      </div>
    </div>
  )

  const notesSection = c.notes ? (
    <PanelSection title="Notes">
      <p className="text-pretty whitespace-pre-wrap">{c.notes}</p>
    </PanelSection>
  ) : null

  const remindersSection = (
    <PanelSection title="Reminders">
      <DetailRow label="Status">
        {c.prefs?.enabled === false ? (
          <Badge variant="warning-outline">Paused</Badge>
        ) : (
          <Badge variant="success-outline">Active</Badge>
        )}
      </DetailRow>
      <DetailRow label="Offsets">
        {(() => {
          // Offsets are a per-stream map now; this read-only row shows the
          // union of every stream's list (the per-stream editor is Task 10).
          const offs = [...new Set(Object.values(c.prefs?.offsets ?? {}).flat())].sort((a, b) => b - a)
          if (offs.length === 0) {
            return (
              <>
                Default
                {settings.data && (
                  <span className="text-muted-foreground font-normal">
                    {' '}({defaultSummary(settings.data)})
                  </span>
                )}
              </>
            )
          }
          return (
            <span className="flex flex-wrap justify-end gap-1">
              {offs.map((n) => (
                <Badge key={n} variant="secondary">D-{n}</Badge>
              ))}
            </span>
          )
        })()}
      </DetailRow>
      <DetailRow label="Channels">
        {(() => {
          const chosen = (channels.data?.channels ?? []).filter((ch) => c.prefs?.channel_ids.includes(ch.id))
          if (chosen.length === 0) {
            // No own selection → the system default channels apply.
            const defaults = (channels.data?.channels ?? []).filter((ch) =>
              (settings.data?.default_channel_ids ?? []).includes(ch.id))
            return (
              <>
                Default
                <span className="text-muted-foreground font-normal">
                  {' '}({defaults.map((d) => d.name).join(', ') || 'all channels'})
                </span>
              </>
            )
          }
          return (
            <span className="flex flex-wrap justify-end gap-1">
              {chosen.map((ch) => (
                <Badge key={ch.id} variant="secondary">{ch.name} ({ch.type})</Badge>
              ))}
            </span>
          )
        })()}
      </DetailRow>
    </PanelSection>
  )

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="font-semibold">Contact</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open fullscreen detail"
            // Rendered as a real link: cmd/ctrl+click, middle-click and
            // the context menu open the fullscreen page in a new tab
            // natively (30e6655); a plain click is the Link's SPA nav.
            render={<Link to="/reminder/contacts/$id" params={{ id }} />}
          >
            <Maximize2Icon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={() => nav({ to: '/reminder/contacts', search: {}, replace: true })}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {identityBlock}
        {notesSection}
        <PanelSection title="Occasions">
          {c.occasions.length === 0 ? (
            <p className="text-muted-foreground">
              No occasions yet — open the fullscreen detail to add one.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {c.occasions.slice(0, 3).map((o) => {
                  const up = upcomingByOccasion.get(o.id)
                  return (
                    <div key={o.id} className="rounded-lg bg-muted/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-muted-foreground text-xs font-medium capitalize">
                            {o.type}
                          </p>
                          <p className="mt-0.5 text-sm font-medium tabular-nums">{shortDate(o.base_date)}</p>
                        </div>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          {/* Per-occasion override: paused occasions notify nothing. */}
                          {o.prefs?.enabled === false && (
                            <Badge variant="warning-outline">Paused</Badge>
                          )}
                          {up && (
                            <Badge
                              variant={up.days_until <= 7 ? 'warning-outline' : 'secondary'}
                              className="shrink-0"
                            >
                              {up.days_until <= 0 ? 'today' : `in ${up.days_until}d`}
                            </Badge>
                          )}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {c.occasions.length > 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mx-auto flex"
                  onClick={() => nav({ to: '/reminder/contacts/$id', params: { id } })}
                >
                  See all {c.occasions.length} occasions
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              )}
            </>
          )}
        </PanelSection>
        {remindersSection}
      </div>
    </div>
  )
}
```

Notes for the implementer:
- The docked panel has no mutations — there is no `toast` import and no `useQueryClient`.
- If lint flags any remaining unused import, remove it. The docked file must not import: `useState`, `useEffect`, `useMutation`, `useQueryClient`, `format`, `OccasionPrefsEditor`, `DateSelectorPopover`, `ReminderTrigger`, `AlertDialog*`, `Card*`, `Checkbox`, `Input`, `Label`, `Select*`, `Switch`, `hydratePrefsForm`, `parseList`, `longDate`, `offsetsSummary`.

- [ ] **Step 4: Verify build and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: clean. If tsc reports unused locals in the slimmed file, remove them.

- [ ] **Step 5: Commit**

```bash
cd /Users/taksu/Work/code/otorem
git add web/src/routes/reminder.contacts.\$id.tsx web/src/routes/reminder.contacts.index.tsx web/src/components/contacts/contact-detail-content.tsx
git commit -m "refactor(web): route uses tabbed page content; docked panel is standalone"
```

---

### Task 7: Verification + UI-polish pass

**Files:**
- Possibly all touched files (fixes only)

**Interfaces:**
- Consumes: everything built in Tasks 1–6.
- Produces: verified, working refactor on `feature/contact-detail-tabs`.

- [ ] **Step 1: Type-check and lint**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 2: Run the dev server and walk every state in the browser**

Run: `cd /Users/taksu/Work/code/otorem/web && pnpm dev`, open the app, then verify on `/reminder/contacts/<some id>`:

1. Card shows two tabs; Occasions tab shows the live count; icons render on both triggers.
2. With occasions present: rows are collapsed, showing icon tile, capitalized type (+label), short date · recurrence copy, countdown badge, and Paused/Custom badges when applicable.
3. Multiple rows can be open at once; chevron rotates; expanded content shows OccasionPrefsEditor; collapse and re-expand — a half-typed offsets input survives (keepMounted).
4. Remind-now and Delete work from the collapsed row; Delete shows the confirm dialog with the long date; deleting removes the row and the tab count updates.
5. "Add occasion" toggles the form; all fields work (type select, custom input + suggestion chips, recurrence, date picker, label, pawukon preview, Feb-29 note); adding appends the row and keeps the form open with fields reset.
6. With zero occasions (delete all on a scratch contact): empty state shows with working CTA that opens the form; adding the first occasion returns to the list view.
7. Reminder Preferences tab: offsets inputs hydrate, Save persists (reload shows saved values), Active switch toggles and saves via Save, channel chips save immediately, global-defaults line renders.
8. Switching tabs with unsaved prefs edits, then back: edits survive (keepMounted panels).
9. Loading: card-shaped skeleton; error: not-found copy on a bogus id.
10. `/reminder/contacts` (index): docked panel renders exactly as before (identity, notes, occasions cap-3, reminders summary, fullscreen + close actions).

- [ ] **Step 3: UI-polish pass (better-ui)**

Check and fix: no button nested inside the accordion trigger (Remind/Delete are Header-level siblings); tabular-nums on date text; icon tiles optically aligned with the two-line text (ItemMedia's translate-y handles it — verify visually); badge cluster doesn't push the title (min-w-0 + truncate hold); transitions limited to color/opacity/rotate (100–200ms); focus-visible rings land on trigger and action buttons.

- [ ] **Step 4: Fix any findings, re-verify, commit**

```bash
cd /Users/taksu/Work/code/otorem
git add -A
git commit -m "fix(web): polish contact detail tabs after walkthrough"
```

(Only if there are changes; otherwise skip.)
