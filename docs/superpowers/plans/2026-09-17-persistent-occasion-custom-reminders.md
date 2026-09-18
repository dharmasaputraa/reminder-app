# Persistent Occasion Custom Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-occasion "Custom reminders" a persistent active/inactive toggle (saved days/channels survive toggling off), restyle channel chips as icon-stacked selectable buttons, add confirm-on-disable dialogs, and gate all occasion switches behind the contact-level master switch with a force-activate dialog.

**Architecture:** A new `custom` column on `occasion_prefs` decouples "has stored values" from "values are live" — the scheduler ignores occasion offsets/channels unless `custom=1`, while the `enabled` kill switch stays independent. The SPA swaps its delete-on-toggle custom switch for a field-oriented PUT, adds confirm dialogs on every disable, and reads the contact's paused state to lock the switches behind a tab-level force-activate dialog.

**Tech Stack:** Go (gin, SQLite via modernc), React 19 + TanStack Query, Base UI primitives (Switch, Collapsible, AlertDialog), Tailwind v4, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-09-17-persistent-occasion-custom-reminders-design.md`

## Global Constraints

- Confirmations fire on **disable only**; enabling is immediate (spec §3).
- Toggling custom off must never wipe `offsets`/`channel_ids` — retention is the point of the feature (spec §Goals 1).
- `enabled` (occasion kill switch) is independent of `custom` (spec §1).
- Legacy PUT payloads without a `custom` field must land as `custom: true` (spec §1).
- Paused gating: switches look disabled but stay clickable (never the `disabled` prop — it swallows clicks); confirming the dialog only flips contact Active, no auto-apply of the clicked switch (spec §5).
- Channel chips have no checkbox; state is pure chip styling (spec §4).
- Go code: module `wimember`, run tests with `go test ./internal/<pkg> -run <Name> -v` from the repo root; run `gofmt -w` on touched Go files before committing.
- Frontend: run `cd web && npx tsc -b && npm run lint` after each frontend task; `npm run build` additionally runs the vite production build (Task 6 and 7). There is no JS test rig — frontend correctness is verified by typecheck, lint, build, and the manual pass in Task 7.
- Commit style matches history: `feat(api): …`, `feat(scheduler): …`, `feat(web): …`.

---

### Task 1: Migration + store `Custom` field

**Files:**
- Create: `internal/store/migrations/002_occasion_prefs_custom.sql`
- Modify: `internal/store/contacts.go:40-45` (`OccasionPrefs` struct), `contacts.go:333-353` (`getOccasionPrefsRow`), `contacts.go:355-369` (`SetOccasionPrefs`)
- Test: `internal/store/contacts_test.go`

**Interfaces:**
- Consumes: existing `OccasionPrefs` struct, `boolInt` helper, `OpenInMemory`/`Migrate` test helpers.
- Produces: `OccasionPrefs.Custom bool` (json `"custom"`) — every later task reads/writes this field. All existing rows read back `Custom=true` (column default 1).

- [ ] **Step 1: Write the failing store test**

Add to `internal/store/contacts_test.go` (after `TestOccasionPrefsRoundTrip`, same setup pattern):

```go
// Toggling custom off persists the row: custom=false keeps offsets and
// channel_ids in place (they reactivate when custom flips back to true).
func TestOccasionPrefsCustomRetainedWhenOff(t *testing.T) {
	ctx := context.Background()
	st, _ := OpenInMemory()
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	u, err := st.GetOrCreateUser(ctx, "custom-off@b.c", "A", nil)
	if err != nil {
		t.Fatal(err)
	}
	ct, err := st.CreateContact(ctx, u.ID, "Ani", "", "")
	if err != nil {
		t.Fatal(err)
	}
	oc, err := st.AddOccasion(ctx, ct.ID, "birthday", domain.RecurYearly, domain.NewDate(2025, 6, 16), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetOccasionPrefs(ctx, OccasionPrefs{OccasionID: oc.ID, Custom: true, Enabled: true,
		Offsets:    domain.OffsetMap{domain.StreamYearly: {7, 3, 0}},
		ChannelIDs: []string{"ch-1", "ch-2"}}); err != nil {
		t.Fatal(err)
	}
	// Toggle custom OFF: the row survives with its values.
	if err := st.SetOccasionPrefs(ctx, OccasionPrefs{OccasionID: oc.ID, Custom: false, Enabled: true,
		Offsets:    domain.OffsetMap{domain.StreamYearly: {7, 3, 0}},
		ChannelIDs: []string{"ch-1", "ch-2"}}); err != nil {
		t.Fatal(err)
	}
	got, err := st.OccasionByID(ctx, u.ID, oc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Prefs == nil {
		t.Fatal("prefs row must exist after custom=false")
	}
	if got.Prefs.Custom {
		t.Error("custom = true, want false")
	}
	if !got.Prefs.Enabled {
		t.Error("enabled must be independent of custom")
	}
	if !reflect.DeepEqual(got.Prefs.Offsets[domain.StreamYearly], []int{7, 3, 0}) {
		t.Errorf("offsets = %v, want [7 3 0] retained", got.Prefs.Offsets[domain.StreamYearly])
	}
	if !reflect.DeepEqual(got.Prefs.ChannelIDs, []string{"ch-1", "ch-2"}) {
		t.Errorf("channel_ids = %v, want retained", got.Prefs.ChannelIDs)
	}
}
```

If `reflect` is not yet imported in the file, add it to the import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/store -run TestOccasionPrefsCustomRetainedWhenOff -v`
Expected: FAIL — compile error `unknown field Custom in struct literal` (the field does not exist yet).

- [ ] **Step 3: Create the migration**

`internal/store/migrations/002_occasion_prefs_custom.sql`:

```sql
-- Custom becomes an explicit flag: a row can exist with custom=0 holding
-- retained offsets/channel_ids that reactivate when custom flips back to 1.
-- Every pre-existing row was created by the old toggle-on path → default 1.
ALTER TABLE occasion_prefs ADD COLUMN custom INTEGER NOT NULL DEFAULT 1;
```

(The migration runner picks up any `NNN_name.sql` from the embedded FS — no registration needed.)

- [ ] **Step 4: Add the field and wire it through the store**

In `internal/store/contacts.go`:

Struct (`OccasionPrefs`):

```go
type OccasionPrefs struct {
	OccasionID string           `json:"occasion_id"`
	Offsets    domain.OffsetMap `json:"offsets"`
	ChannelIDs []string         `json:"channel_ids"`
	Enabled    bool             `json:"enabled"`
	Custom     bool             `json:"custom"`
}
```

`getOccasionPrefsRow` — select and scan the new column:

```go
func (s *Store) getOccasionPrefsRow(ctx context.Context, occasionID string) (*OccasionPrefs, error) {
	var offsets, channelIDs string
	var enabled, custom int
	err := s.db.QueryRowContext(ctx,
		`SELECT offsets, channel_ids, enabled, custom FROM occasion_prefs WHERE occasion_id = ?`, occasionID).
		Scan(&offsets, &channelIDs, &enabled, &custom)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil // inherit — not an error
	}
	if err != nil {
		return nil, err
	}
	p := &OccasionPrefs{OccasionID: occasionID, Enabled: enabled == 1, Custom: custom == 1,
		Offsets: domain.OffsetMap{}, ChannelIDs: []string{}}
	if err := json.Unmarshal([]byte(offsets), &p.Offsets); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(channelIDs), &p.ChannelIDs); err != nil {
		return nil, err
	}
	return p, nil
}
```

`SetOccasionPrefs` — persist the new column:

```go
	_, err = s.db.ExecContext(ctx, `INSERT INTO occasion_prefs (occasion_id, offsets, channel_ids, enabled, custom)
		VALUES (?,?,?,?,?) ON CONFLICT(occasion_id) DO UPDATE SET offsets=excluded.offsets,
		channel_ids=excluded.channel_ids, enabled=excluded.enabled, custom=excluded.custom`,
		p.OccasionID, string(off), string(ch), boolInt(p.Enabled), boolInt(p.Custom))
	return err
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `gofmt -w internal/store/contacts.go internal/store/contacts_test.go && go test ./internal/store -v`
Expected: ALL store tests PASS, including `TestOccasionPrefsRoundTrip` (unchanged semantics — the migration backfills `custom=1`) and the new `TestOccasionPrefsCustomRetainedWhenOff`.

- [ ] **Step 6: Commit**

```bash
git add internal/store/migrations/002_occasion_prefs_custom.sql internal/store/contacts.go internal/store/contacts_test.go
git commit -m "feat(api): occasion_prefs gains persistent custom flag"
```

---

### Task 2: API wire shape

**Files:**
- Modify: `internal/api/occasionprefs.go` (whole file is ~100 lines; `occasionPrefsIn`, `handleGetOccasionPrefs`, `handleSetOccasionPrefs`)
- Test: `internal/api/server_test.go`

**Interfaces:**
- Consumes: `store.OccasionPrefs.Custom` from Task 1.
- Produces: PUT `/occasions/:id/prefs` accepts `"custom": bool` (absent → stored/defaults as `true`); GET default payload for a rowless occasion is `{occasion_id, offsets:{}, channel_ids:[], enabled:true, custom:false}`.

- [ ] **Step 1: Write the failing API test**

Add to `internal/api/server_test.go` (after `TestOccasionPrefsEndpoints`; reuses its file-level helpers `newTestServer`, `createContact`, `addOccasion`, `contactOccasion`):

```go
// The custom flag: default GET payload says inherit (custom=false), a legacy
// PUT without the field lands as custom=true, and PUT custom=false retains
// the stored offsets/channels instead of wiping them.
func TestOccasionPrefsCustomFlag(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	cid := createContact(t, srv, "admin@x.id", `{"name":"Made"}`)
	occID := addOccasion(t, srv, "admin@x.id", cid,
		`{"type":"birthday","date":"2025-06-16","recurrence":"yearly"}`)

	prefsReq := func(method, id, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		srv.ServeHTTP(w, devReq(t, method, "/api/v1/occasions/"+id+"/prefs", "admin@x.id", body))
		return w
	}

	// No row → the inherit default carries custom:false.
	w := prefsReq("GET", occID, "")
	var d store.OccasionPrefs
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if d.Custom {
		t.Errorf("default payload custom = true, want false: %s", w.Body.String())
	}

	// Legacy payload (no custom field) → custom=true on the stored row.
	if w := prefsReq("PUT", occID, `{"offsets":{"yearly":[7]},"channel_ids":[],"enabled":true}`); w.Code != 200 {
		t.Fatalf("legacy put: %d %s", w.Code, w.Body.String())
	}
	if oc := contactOccasion(t, srv, "admin@x.id", cid, occID); oc.Prefs == nil || !oc.Prefs.Custom {
		t.Errorf("legacy put must store custom=true, got %+v", oc.Prefs)
	}

	// PUT custom=false keeps the values (they are retained, not wiped).
	w = prefsReq("PUT", occID, `{"offsets":{"yearly":[7]},"channel_ids":[],"enabled":true,"custom":false}`)
	if w.Code != 200 {
		t.Fatalf("put custom=false: %d %s", w.Code, w.Body.String())
	}
	oc := contactOccasion(t, srv, "admin@x.id", cid, occID)
	if oc.Prefs == nil || oc.Prefs.Custom {
		t.Fatalf("custom = %+v, want false with values retained", oc.Prefs)
	}
	if !reflect.DeepEqual(oc.Prefs.Offsets[domain.StreamYearly], []int{7}) {
		t.Errorf("offsets = %v, want [7] retained", oc.Prefs.Offsets[domain.StreamYearly])
	}

	// Flipping back on reactivates the retained values.
	if w := prefsReq("PUT", occID, `{"offsets":{"yearly":[7]},"channel_ids":[],"enabled":true,"custom":true}`); w.Code != 200 {
		t.Fatalf("put custom=true: %d %s", w.Code, w.Body.String())
	}
	if oc := contactOccasion(t, srv, "admin@x.id", cid, occID); oc.Prefs == nil || !oc.Prefs.Custom {
		t.Errorf("custom = %+v, want true", oc.Prefs)
	}
}
```

If `reflect` is not imported in server_test.go, add it (the existing prefs tests already use it — check first).

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/api -run TestOccasionPrefsCustomFlag -v`
Expected: FAIL — `default payload custom = true, want false` (the zero-value bool decodes false, but the legacy-PUT case fails: nothing stores `custom` yet, so the stored row reads back `custom=false`).

- [ ] **Step 3: Update the handlers**

In `internal/api/occasionprefs.go`:

```go
// occasionPrefsIn: full-replace payload. An absent offsets map decodes as nil
// and is stored as {} = inherit every stream. An absent custom decodes as
// true: legacy payloads always meant custom-on.
type occasionPrefsIn struct {
	Offsets    domain.OffsetMap `json:"offsets"`
	ChannelIDs *[]string        `json:"channel_ids"`
	Enabled    *bool            `json:"enabled"`
	Custom     *bool            `json:"custom"`
}
```

`handleGetOccasionPrefs` — the default payload gains `Custom: false`:

```go
	if occ.Prefs == nil {
		c.JSON(200, store.OccasionPrefs{OccasionID: id, Offsets: domain.OffsetMap{}, ChannelIDs: []string{}, Enabled: true, Custom: false})
		return
	}
```

(Custom false is the zero value, but spell it out to match the explicit default shape.)

`handleSetOccasionPrefs` — default the row to custom-on, then take the field if sent:

```go
	p := store.OccasionPrefs{OccasionID: id, Offsets: in.Offsets, ChannelIDs: []string{}, Enabled: true, Custom: true}
	if p.Offsets == nil {
		p.Offsets = domain.OffsetMap{}
	}
	if in.ChannelIDs != nil {
		p.ChannelIDs = *in.ChannelIDs
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if in.Custom != nil {
		p.Custom = *in.Custom
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `gofmt -w internal/api/occasionprefs.go internal/api/server_test.go && go test ./internal/api -v`
Expected: ALL api tests PASS — including the pre-existing `TestOccasionPrefsEndpoints` (its legacy payloads keep working via the absent→true default).

- [ ] **Step 5: Commit**

```bash
git add internal/api/occasionprefs.go internal/api/server_test.go
git commit -m "feat(api): occasion prefs PUT/GET carry the custom flag"
```

---

### Task 3: Scheduler custom gate

**Files:**
- Modify: `internal/scheduler/scheduler.go:205-226` (occasion loop: channel + offsets resolution)
- Test: `internal/scheduler/scheduler_test.go`

**Interfaces:**
- Consumes: `store.OccasionPrefs.Custom` from Task 1.
- Produces: behavior — occasion offsets/channel_ids apply only when `prefs.Custom`; otherwise the contact → settings → default chain is used. No signature changes.

- [ ] **Step 1: Update the two existing override tests to Custom:true**

`TestOccasionChannelOverride` and `TestOccasionOffsetsOverride` model custom-on overrides; under the new gate their `SetOccasionPrefs` literals must say so, or the overrides would be (correctly) ignored. In `internal/scheduler/scheduler_test.go`:

In `TestOccasionChannelOverride` (~line 679):

```go
	if err := h.st.SetOccasionPrefs(context.Background(), store.OccasionPrefs{
		OccasionID: f.Occasion.ID, ChannelIDs: []string{chB.ID}, Enabled: true, Custom: true,
	}); err != nil {
		t.Fatal(err)
	}
```

In `TestOccasionOffsetsOverride` (~line 720):

```go
	if err := h.st.SetOccasionPrefs(context.Background(), store.OccasionPrefs{
		OccasionID: f.Occasion.ID, Enabled: true, Custom: true,
		Offsets: domain.OffsetMap{domain.StreamMonthly: {1, 0}},
	}); err != nil {
		t.Fatal(err)
	}
```

Also update `TestOccasionDisabledByOccasionPrefs` (~line 546) to `Custom: true` so it keeps testing exactly one variable (the enabled kill switch on a custom row):

```go
	if err := h.st.SetOccasionPrefs(context.Background(), store.OccasionPrefs{
		OccasionID: f.Occasion.ID, Enabled: false, Custom: true,
	}); err != nil {
		t.Fatal(err)
	}
```

- [ ] **Step 2: Write the failing inherit test**

Add to `internal/scheduler/scheduler_test.go` (after `TestOccasionChannelOverride`; uses the file's existing `newBareHarness`, `seedAnniversary`, `snapUTC`, `hasNotif` helpers):

```go
// custom=false suspends the occasion overrides without deleting them: the
// occasion falls back to the contact chain (settings monthly [0], channel A)
// even though the retained row points at offset D-1 and channel B — and the
// enabled kill switch still wins on the same row.
func TestOccasionCustomFalseInheritsContactChain(t *testing.T) {
	h := newBareHarness(t, time.Date(2025, 12, 16, 8, 1, 0, 0, time.UTC))
	f := seedAnniversary(t, h.st, "custom-off-inherit@x.id")
	chB, err := h.st.CreateChannel(context.Background(), f.User.ID, "telegram", "b", []byte("enc"))
	if err != nil {
		t.Fatal(err)
	}
	// Retained-but-inactive overrides: D-1 on the monthly stream, channel B.
	if err := h.st.SetOccasionPrefs(context.Background(), store.OccasionPrefs{
		OccasionID: f.Occasion.ID, Enabled: true, Custom: false,
		Offsets:    domain.OffsetMap{domain.StreamMonthly: {1, 0}},
		ChannelIDs: []string{chB.ID},
	}); err != nil {
		t.Fatal(err)
	}
	rec := h.recordChannels()
	snap := snapUTC()
	snap.RecurrenceOffsets = domain.DefaultRecurrenceOffsets()

	res, err := h.svc.RunOnce(context.Background(), snap)
	if err != nil {
		t.Fatal(err)
	}
	// The k=6 monthly mark D-0 fires on the cascade channel A, not B; no D-1
	// row exists because the retained monthly [1,0] never became live.
	if res.Sent != 1 || res.Missed != 1 {
		t.Fatalf("res = %+v, want Sent 1 Missed 1 (contact-chain behavior)", res)
	}
	got := rec.messages()
	if len(got) != 1 || got[0].ChannelID != f.Channel.ID {
		t.Fatalf("pushes = %+v, want exactly one on channel A %s", got, f.Channel.ID)
	}
	if !hasNotif(t, h.st, f.Occasion.ID, f.Channel.ID, domain.NewDate(2025, 12, 16), 0) {
		t.Error("contact-chain D-0 row missing on channel A")
	}
	if hasNotif(t, h.st, f.Occasion.ID, chB.ID, domain.NewDate(2025, 12, 16), 0) {
		t.Error("inactive custom override leaked onto channel B")
	}
	if hasNotif(t, h.st, f.Occasion.ID, f.Channel.ID, domain.NewDate(2025, 12, 16), 1) {
		t.Error("retained D-1 must not fire while custom=false")
	}

	// The same row with enabled=false still skips the occasion entirely: the
	// second scan produces nothing new (no pushes beyond run 1's single one).
	if err := h.st.SetOccasionPrefs(context.Background(), store.OccasionPrefs{
		OccasionID: f.Occasion.ID, Enabled: false, Custom: false,
		Offsets:    domain.OffsetMap{domain.StreamMonthly: {1, 0}},
		ChannelIDs: []string{chB.ID},
	}); err != nil {
		t.Fatal(err)
	}
	res, err = h.svc.RunOnce(context.Background(), snap)
	if err != nil {
		t.Fatal(err)
	}
	if res != (Result{}) || len(rec.messages()) != 1 {
		t.Fatalf("res = %+v, want zero once enabled=false (pushes stay at 1)", res)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/scheduler -run TestOccasionCustomFalseInheritsContactChain -v`
Expected: FAIL — the push lands on channel B and a D-1 row exists (today the gate does not exist, so the retained row is live).

- [ ] **Step 4: Add the gate in the occasion loop**

In `internal/scheduler/scheduler.go`, the occasion loop currently reads (~lines 209-226):

```go
			// Channels: occasion override → contact cascade (already resolved).
			channels := defaultChannels
			if occ.Prefs != nil && len(occ.Prefs.ChannelIDs) > 0 {
				if byID := filterChannels(defaultChannels, occ.Prefs.ChannelIDs); len(byID) > 0 {
					channels = byID
				}
			}
			// Offsets per stream: occasion → contact → settings → DefaultOffsets.
			// Prefs rows are optional, so the offsets maps are read through the
			// pointers (nil prefs = pure inherit).
			var occOff, contactOff domain.OffsetMap
			if occ.Prefs != nil {
				occOff = occ.Prefs.Offsets
			}
```

Replace with:

```go
			// Channels: occasion override → contact cascade (already resolved).
			// An override row with custom=false holds retained-but-inactive
			// values: the occasion inherits as if the row were absent.
			channels := defaultChannels
			if occ.Prefs != nil && occ.Prefs.Custom && len(occ.Prefs.ChannelIDs) > 0 {
				if byID := filterChannels(defaultChannels, occ.Prefs.ChannelIDs); len(byID) > 0 {
					channels = byID
				}
			}
			// Offsets per stream: occasion → contact → settings → DefaultOffsets.
			// Prefs rows are optional, so the offsets maps are read through the
			// pointers (nil prefs = pure inherit); custom=false ignores occOff.
			var occOff, contactOff domain.OffsetMap
			if occ.Prefs != nil && occ.Prefs.Custom {
				occOff = occ.Prefs.Offsets
			}
```

The `enabled` check earlier in the loop (`if occ.Prefs != nil && !occ.Prefs.Enabled { continue }`) is untouched — it already runs first and is independent of custom.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `gofmt -w internal/scheduler/scheduler.go internal/scheduler/scheduler_test.go && go test ./internal/scheduler -v`
Expected: ALL scheduler tests PASS — the new inherit test plus the updated override tests (now `Custom: true`) and the kill-switch test.

- [ ] **Step 6: Commit**

```bash
git add internal/scheduler/scheduler.go internal/scheduler/scheduler_test.go
git commit -m "feat(scheduler): occasion overrides apply only while custom is on"
```

---

### Task 4: Editor — custom persistence, titles, confirm dialogs, locked panel

**Files:**
- Modify: `web/src/lib/api.ts:60` (`OccasionPrefs` type)
- Modify: `web/src/components/contacts/occasion-prefs-editor.tsx` (whole component)
- Test: none (no JS test rig) — verified by `tsc`, lint, and the manual pass in Task 7.

**Interfaces:**
- Consumes: API from Task 2 (`custom` on the occasion prefs wire).
- Produces: `OccasionPrefsEditor` gains required props `paused: boolean` and `onPausedInteraction: () => void` (Task 6 supplies them). `Row` (internal) gains `custom: boolean`; `rowFrom`, `sameRow` handle it. Channel chips markup is unchanged in this task (Task 5 restyles it).

- [ ] **Step 1: Add the field to the wire type**

In `web/src/lib/api.ts`:

```ts
export interface OccasionPrefs { occasion_id: string; offsets: OffsetMap; channel_ids: string[]; enabled: boolean; custom: boolean }
```

- [ ] **Step 2: Rework the editor's state and handlers**

In `occasion-prefs-editor.tsx`:

(a) Imports — the file gains `cn` (it does not import it today) and the AlertDialog set:

```tsx
import { cn } from 'cn'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
```

(b) Props — the component signature becomes:

```tsx
export function OccasionPrefsEditor({
  contactId,
  occasion,
  channels,
  paused,
  onPausedInteraction,
}: {
  contactId: string
  occasion: Occasion
  channels: Channel[]
  /** Contact-level master switch is off: every switch here is locked. */
  paused: boolean
  /** A locked switch was clicked — the parent opens the force-activate dialog. */
  onPausedInteraction: () => void
}) {
```

(c) `Row` and helpers — add `custom` throughout:

```tsx
/** The whole override row — exactly the wire shape of the full-replace PUT. */
interface Row {
  offsets: OffsetMap
  channel_ids: string[]
  enabled: boolean
  custom: boolean
}

/** The server's row (or the inherit-all default when there is none). */
function rowFrom(p: OccasionPrefs | null | undefined): Row {
  return {
    offsets: p?.offsets ?? {},
    channel_ids: p?.channel_ids ?? [],
    enabled: p?.enabled ?? true,
    custom: p?.custom ?? false,
  }
}

/** Value equality — a resync that changes nothing must not churn the UI. */
function sameRow(a: Row, b: Row): boolean {
  const keysA = Object.keys(a.offsets)
  const keysB = Object.keys(b.offsets)
  return (
    a.enabled === b.enabled &&
    a.custom === b.custom &&
    a.channel_ids.length === b.channel_ids.length &&
    a.channel_ids.every((id, i) => id === b.channel_ids[i]) &&
    keysA.length === keysB.length &&
    keysA.every((k) => (a.offsets[k] ?? []).join(',') === (b.offsets[k] ?? []).join(','))
  )
}
```

(d) Replace the custom/inherit state block. Delete the `reset` mutation entirely (the UI never deletes the row again) and the `toggleCustom` that called it. `custom` now reads from the row, and the confirm dialog takes over the off direction:

```tsx
  // Custom = the occasion's override values are live (vs retained-but-inactive).
  const [custom, setCustom] = useState(() => p?.custom ?? false)
  // The panel starts open only when the occasion carries actual values.
  const [customOpen, setCustomOpen] = useState(
    () => (p?.custom ?? false) && (streams.some((s) => (row.offsets[s] ?? []).length > 0) || row.channel_ids.length > 0),
  )
  // Pending disable awaiting confirmation: which switch was toggled off.
  const [confirm, setConfirm] = useState<null | 'occasion' | 'custom'>(null)

  /** Inherit ↔ custom. OFF asks first; the values stay on the row either way. */
  const toggleCustom = (on: boolean) => {
    if (paused) {
      onPausedInteraction()
      return
    }
    if (on) {
      setCustomOpen(true)
      if (!rowRef.current.custom) saveRow({ ...rowRef.current, custom: true })
    } else {
      setConfirm('custom')
    }
  }

  /** The confirmed disable: save the flag, keep the data. */
  const confirmDisable = () => {
    const kind = confirm
    setConfirm(null)
    if (kind === 'custom') {
      setCustomOpen(false)
      saveRow({ ...rowRef.current, custom: false })
    } else if (kind === 'occasion') {
      saveRow({ ...rowRef.current, enabled: false })
    }
  }
```

(e) The pending-resync effect no longer watches `reset`:

```tsx
  const pendingRef = useRef(false)
  useEffect(() => {
    pendingRef.current = save.isPending
  }, [save.isPending])
```

and the sync effect adopts `custom` from the row, not row presence:

```tsx
  useEffect(() => {
    if (pendingRef.current) return
    syncFromServer(rowFrom(occasion.prefs))
    setCustom(occasion.prefs?.custom ?? false)
  }, [occasion.id, occasion.prefs, syncFromServer])
```

(f) Both switches — paused clicks detour to the parent, disables confirm, enables apply at once. The "Reminders for this occasion" header label flips with state:

```tsx
      <FramePanel fit className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Reminders for this occasion</span>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={row.enabled}
            aria-disabled={paused || undefined}
            className={cn(paused && 'opacity-50')}
            onCheckedChange={(v) => {
              if (paused) {
                onPausedInteraction()
                return
              }
              if (v) saveRow({ ...rowRef.current, enabled: true })
              else setConfirm('occasion')
            }}
          />
          {row.enabled ? 'Active' : 'Inactive'}
        </label>
      </FramePanel>
```

The custom switch (in `FrameHeader`) — title flips with state, trigger locks when inactive:

```tsx
      <Collapsible open={customOpen} onOpenChange={setCustomOpen} className="group/collapsible">
        <FrameHeader className="flex flex-row items-center justify-between gap-2">
          <CollapsibleTrigger
            disabled={!custom}
            className="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
          >
            <FrameTitle className="text-sm font-medium">{custom ? 'Custom reminders' : 'Inherit reminders'}</FrameTitle>
            {custom && (
              <ChevronRightIcon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
              />
            )}
          </CollapsibleTrigger>
          <Switch
            checked={custom}
            disabled={save.isPending}
            aria-disabled={paused || undefined}
            className={cn(paused && 'opacity-50')}
            onCheckedChange={(v) => toggleCustom(v === true)}
            aria-label="Use custom reminders"
          />
        </FrameHeader>
```

(g) The locked-panel hint + retention caption. Directly after the `FrameHeader` (inside the `Collapsible`, before `CollapsibleContent`), render the retained-data line when custom is off:

```tsx
        {!custom && savedHint() !== '' && (
          <FramePanel fit className="text-muted-foreground text-xs">{savedHint()}</FramePanel>
        )}
```

with the formatter defined above the return (after `savedOffsets` — it reads `row.offsets`, so it always reflects the current row):

```tsx
  /** What the inactive row retains, e.g. "Saved: 7, 3, 0 · 2 channels". */
  const savedHint = (): string => {
    const parts: string[] = []
    const offs = savedOffsets()
    if (offs.length > 0) parts.push(offs.join(', '))
    if (row.channel_ids.length > 0) parts.push(`${row.channel_ids.length} channel${row.channel_ids.length === 1 ? '' : 's'}`)
    return parts.length > 0 ? `Saved: ${parts.join(' · ')}` : ''
  }
```

(Keep it a function called inline — a plain const computed once per render is fine here since `row` changes trigger a re-render, but the call form keeps the JSX honest about freshness.)

Replace the old closing caption inside the panel:

```tsx
            <p className="text-muted-foreground text-xs">
              Turn off to inherit from the contact — saved days and channels are kept for when you turn it back on.
            </p>
```

(h) The confirm dialog, before the component's closing tag:

```tsx
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'custom' ? 'Switch to inherit reminders?' : 'Pause reminders for this occasion?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'custom'
                ? 'The occasion will use the contact defaults. Saved days and channels are kept and restored when you re-enable custom reminders.'
                : 'This occasion sends no notifications until you turn it back on.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable}>
              {confirm === 'custom' ? 'Switch to inherit' : 'Pause'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd web && npx tsc -b && npm run lint`
Expected: clean — no type errors (this task compiles only because Task 6 hasn't run; if `tsc` flags `OccasionPrefsEditor` call sites missing the new props, that is expected — those live in `occasions-tab.tsx` and are fixed in Task 6. If tsc hard-fails the build here, temporarily satisfy it by passing `paused={false} onPausedInteraction={() => {}}` at the call site in occasions-tab.tsx and leave a note for Task 6 to replace them.)

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/components/contacts/occasion-prefs-editor.tsx web/src/components/contacts/occasions-tab.tsx
git commit -m "feat(web): persistent custom reminders with confirm-on-disable"
```

---

### Task 5: Editor — stacked channel chips with type icons

**Files:**
- Create: `web/src/lib/channel-icons.ts`
- Modify: `web/src/components/contacts/occasion-prefs-editor.tsx` (the channels block only)
- Test: none — typecheck, lint, manual pass.

**Interfaces:**
- Consumes: `Row`/`saveRow` from Task 4; lucide-react icons.
- Produces: `channelIcon(type: string): LucideIcon` — exported for reuse (e.g. the settings channels list).

- [ ] **Step 1: Create the icon map**

`web/src/lib/channel-icons.ts`:

```ts
import { MailIcon, MessageSquareIcon, SendIcon, type LucideIcon } from 'lucide-react'

/** Per-channel-type icon. gotify has no dedicated glyph — a plain message
 *  square stands in for it and for any unknown type. */
export function channelIcon(type: string): LucideIcon {
  switch (type) {
    case 'email':
      return MailIcon
    case 'telegram':
      return SendIcon
    default:
      return MessageSquareIcon
  }
}
```

- [ ] **Step 2: Replace the checkbox chips with stacked selectable buttons**

In `occasion-prefs-editor.tsx`, replace the whole `{channels.length > 0 && (...)}` block with:

```tsx
            {channels.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Channels</div>
                <div className="flex flex-wrap gap-2">
                  {channels.map((ch) => {
                    const ChIcon = channelIcon(ch.type)
                    const checked = row.channel_ids.includes(ch.id)
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => {
                          const cur = rowRef.current.channel_ids
                          const next = checked ? cur.filter((id) => id !== ch.id) : [...cur, ch.id]
                          saveRow({ ...rowRef.current, channel_ids: next })
                        }}
                        className={cn(
                          'flex w-20 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                          checked
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        <ChIcon aria-hidden="true" className="size-4" />
                        <span className="w-full truncate text-center">{ch.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
```

Add the import: `import { channelIcon } from '@/lib/channel-icons'`. The `Checkbox` import is no longer used by this file — remove it.

- [ ] **Step 3: Typecheck and lint**

Run: `cd web && npx tsc -b && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/channel-icons.ts web/src/components/contacts/occasion-prefs-editor.tsx
git commit -m "feat(web): stacked channel chips with per-type icons"
```

---

### Task 6: Occasions tab — paused gating, banner, force-activate dialog, badges

**Files:**
- Modify: `web/src/components/contacts/occasions-tab.tsx` (component + `OccasionCard`)
- Test: none — typecheck, lint, manual pass.

**Interfaces:**
- Consumes: `OccasionPrefsEditor`'s `paused`/`onPausedInteraction` props (Task 4); `prefs.custom` (Task 4's api.ts change); `invalidateContactReminders` from `@/lib/prefs` (already imported).
- Produces: nothing exported; tab-level behavior.

- [ ] **Step 1: Paused state, force-activate mutation, dialog in `OccasionsTab`**

In `occasions-tab.tsx`:

(a) Derive paused and add state + mutation inside `OccasionsTab` (next to the existing state):

```tsx
  // Contact-level master switch off → every per-occasion switch is locked.
  const paused = contact.prefs?.enabled === false
  const [pausedDialogOpen, setPausedDialogOpen] = useState(false)
  const activateAll = useMutation({
    mutationFn: () =>
      api(`/contacts/${contact.id}/prefs`, { method: 'PUT', body: JSON.stringify({ enabled: true }) }),
    onSuccess: () => {
      invalidateContactReminders(qc, contact.id)
      toast.success('Notifications enabled')
    },
    onError: (e) => toast.error(`Failed to enable notifications: ${String(e)}`),
  })
```

(b) Pass the props down through both call sites (`<OccasionCard … />` inside the Accordion):

```tsx
              <OccasionCard
                key={o.id}
                contact={contact}
                occasion={o}
                up={upcomingByOccasion.get(o.id)}
                channels={channels}
                paused={paused}
                onPausedInteraction={() => setPausedDialogOpen(true)}
                open={openItems.includes(o.id)}
                onEdit={() => setEditOcc(o)}
                onDelete={() => setDelOcc(o)}
              />
```

(c) Banner above the list — inside `CardContent`, right before the `{contact.occasions.length === 0 ? ( … ) : ( <Accordion …` branch:

```tsx
        {paused && (
          <div className="text-muted-foreground mb-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <BellOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Notifications are paused for this contact — enable them in Reminder Preferences.</span>
          </div>
        )}
```

(d) The force-activate dialog — render alongside `addDialog`/`editDialog`/`deleteDialog` at the bottom of `CardContent`:

```tsx
        <AlertDialog open={pausedDialogOpen} onOpenChange={setPausedDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Notifications are paused</AlertDialogTitle>
              <AlertDialogDescription>
                Reminders for this contact are paused in Reminder Preferences. Turn notifications back on to
                unlock the switches below — nothing else changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => activateAll.mutate()}>Activate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
```

(e) Import `BellOffIcon` (add to the existing lucide-react import list).

- [ ] **Step 2: Thread props through `OccasionCard`, fix the Custom badge**

`OccasionCard`'s props gain `paused: boolean` and `onPausedInteraction: () => void`, forwarded to the editor:

```tsx
function OccasionCard({
  contact,
  occasion: o,
  up,
  channels,
  paused,
  onPausedInteraction,
  open,
  onEdit,
  onDelete,
}: {
  contact: Contact
  occasion: Occasion
  /** Next occurrence of this occasion — undefined when none is upcoming. */
  up?: { date: string; days_until: number }
  channels: Channel[]
  paused: boolean
  onPausedInteraction: () => void
  open: boolean
  onEdit: () => void
  onDelete: () => void
}) {
```

and in the `AccordionContent`:

```tsx
      <AccordionContent>
        <div className="border-t px-4 pb-4 pt-3">
          <OccasionPrefsEditor
            contactId={contact.id}
            occasion={o}
            channels={channels}
            paused={paused}
            onPausedInteraction={onPausedInteraction}
          />
        </div>
      </AccordionContent>
```

Badge fix — "Custom" must key on the flag, not row presence (both the mobile stack ~line 337 and the desktop row ~line 347):

```tsx
              {o.prefs?.custom === true && <Badge variant="outline">Custom</Badge>}
```

(The `Paused` badge line stays as-is.)

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd web && npx tsc -b && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/contacts/occasions-tab.tsx
git commit -m "feat(web): gate occasion switches behind paused contacts"
```

---

### Task 7: Full verification

**Files:** none (verification only).

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Backend suite**

Run: `go vet ./... && go test ./...`
Expected: all packages clean, all tests pass.

- [ ] **Step 2: Frontend build**

Run: `cd web && npx tsc -b && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Manual pass through every flow** (`cd web && npm run dev`, open a contact with occasions):

1. Custom ON → panel opens; type offsets, check channels; toggle Custom OFF → dialog appears; Cancel → still custom; confirm → title "Inherit reminders", panel locked, hint `Saved: 7, 3, 0 · N channels`; reload the page → values still retained.
2. Toggle Custom ON → no dialog, panel reopens with the saved values.
3. "Reminders for this occasion" OFF → dialog; confirm → label reads "Inactive"; ON → immediate, label "Active".
4. Reminder Preferences tab → switch Active off → back to Occasions: banner visible, both switches dimmed but clickable; clicking either opens the paused dialog; Activate → banner gone, switches usable again.
5. Occasion list: a custom-inactive occasion shows no "Custom" badge; a paused one shows "Paused".

- [ ] **Step 4: No commit** — Task 7 produces no diff; fix anything that fails in the responsible task and re-run.
