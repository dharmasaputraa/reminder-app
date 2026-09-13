package calendarprov

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"otorem/internal/domain"
	"otorem/internal/store"
)

func TestDayOffAPIParse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("year") != "2026" {
			t.Errorf("year = %q", r.URL.Query().Get("year"))
		}
		io.WriteString(w, `[{"tanggal":"2026-03-19","keterangan":"Nyepi","is_cuti_bersama":false},
			{"tanggal":"2026-12-25","keterangan":"Natal","is_cuti_bersama":true}]`)
	}))
	defer srv.Close()
	d := NewDayOffAPI()
	d.BaseURL = srv.URL
	hs, err := d.HolidaysBetween(context.Background(), domain.NewDate(2026, 3, 1), domain.NewDate(2026, 4, 1))
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 1 || hs[0].Name != "Libur Nasional — Nyepi" || hs[0].Date != (domain.Date{Year: 2026, Month: 3, Day: 19}) {
		t.Errorf("hs = %+v", hs)
	}
}

func TestKresnaParseWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":[{"holiday_date":"2026-06-17","holiday_name":"Galungan"}]}`)
	}))
	defer srv.Close()
	k := NewKresna(srv.URL)
	hs, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30))
	if err != nil {
		t.Fatal(err)
	}
	if len(hs) != 1 || hs[0].Name != "Galungan" {
		t.Errorf("hs = %+v", hs)
	}
}

func TestCachedRemoteCacheFirst(t *testing.T) {
	st, _ := store.OpenInMemory()
	defer st.Close()
	_ = st.Migrate()

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		io.WriteString(w, `[{"tanggal":"2026-03-19","keterangan":"Nyepi","is_cuti_bersama":false}]`)
	}))
	defer srv.Close()
	inner := NewDayOffAPI()
	inner.BaseURL = srv.URL
	c := NewCachedRemote(inner, st)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		hs, err := c.HolidaysBetween(ctx, domain.NewDate(2026, 3, 10), domain.NewDate(2026, 3, 20))
		if err != nil {
			t.Fatal(err)
		}
		if len(hs) != 1 {
			t.Fatalf("hs = %+v", hs)
		}
	}
	if calls != 1 {
		t.Errorf("remote dipanggil %d×, want 1 (cache-first)", calls)
	}
}

// TestCachedRemoteStaleFallback: cache >24 jam + refresh gagal (server 500)
// → tetap balikin data stale, scheduler tidak boleh mati.
func TestCachedRemoteStaleFallback(t *testing.T) {
	st, _ := store.OpenInMemory()
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	stale := cachePayload{
		FetchedAt: time.Now().Add(-48 * time.Hour),
		Holidays:  []domain.Holiday{{Date: domain.NewDate(2026, 3, 19), Name: "Libur Nasional — Nyepi"}},
	}
	if err := st.PutHolidayCache(context.Background(), 2026, "dayoffapi", stale); err != nil {
		t.Fatal(err)
	}

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "down", http.StatusInternalServerError)
	}))
	defer srv.Close()
	inner := NewDayOffAPI()
	inner.BaseURL = srv.URL
	c := NewCachedRemote(inner, st)

	hs, err := c.HolidaysBetween(context.Background(), domain.NewDate(2026, 3, 10), domain.NewDate(2026, 3, 20))
	if err != nil {
		t.Fatalf("stale fallback harus sukses: %v", err)
	}
	if len(hs) != 1 || hs[0].Name != "Libur Nasional — Nyepi" {
		t.Errorf("hs = %+v", hs)
	}
	if calls != 1 {
		t.Errorf("refresh harus dicoba sekali, calls = %d", calls)
	}
}

// TestCachedRemoteFailureBackoff: remote mati + cache kosong → panggilan
// pertama mencoba remote sekali (hasil set kosong, tanpa error); panggilan
// berikutnya harus ditahan backoff (negative cache), bukan retry tiap
// scan/request. Setelah window lewat (FailBackoff = 0) → dicoba lagi.
func TestCachedRemoteFailureBackoff(t *testing.T) {
	st, _ := store.OpenInMemory()
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}

	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "down", http.StatusInternalServerError)
	}))
	defer srv.Close()
	inner := NewDayOffAPI()
	inner.BaseURL = srv.URL
	c := NewCachedRemote(inner, st)
	ctx := context.Background()
	ran := domain.NewDate(2026, 3, 10)

	// (a) panggilan pertama: satu-satunya percobaan remote.
	hs, err := c.HolidaysBetween(ctx, ran, domain.NewDate(2026, 3, 20))
	if err != nil {
		t.Fatalf("remote mati + cache kosong harus no-op, bukan error: %v", err)
	}
	if len(hs) != 0 {
		t.Errorf("hs = %+v, want kosong", hs)
	}
	// (a) panggilan kedua langsung: backoff → tanpa HTTP call baru.
	if _, err := c.HolidaysBetween(ctx, ran, domain.NewDate(2026, 3, 20)); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (backoff harus menahan retry)", calls)
	}

	// (b) window backoff lewat (FailBackoff = 0) → remote dicoba lagi.
	c.FailBackoff = 0
	if _, err := c.HolidaysBetween(ctx, ran, domain.NewDate(2026, 3, 20)); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Errorf("calls = %d, want 2 (backoff lewat → retry)", calls)
	}
}

// TestCachedRemoteBackoffClearedOnSuccess: refresh sukses harus menghapus
// fail memory, sehingga kegagalan berikutnya backoff dari nol lagi.
func TestCachedRemoteBackoffClearedOnSuccess(t *testing.T) {
	st, _ := store.OpenInMemory()
	defer st.Close()
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}

	healthy := false
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if !healthy {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		io.WriteString(w, `[{"tanggal":"2026-03-19","keterangan":"Nyepi","is_cuti_bersama":false}]`)
	}))
	defer srv.Close()
	inner := NewDayOffAPI()
	inner.BaseURL = srv.URL
	c := NewCachedRemote(inner, st)
	ran := domain.NewDate(2026, 3, 10)

	if _, err := c.HolidaysBetween(context.Background(), ran, domain.NewDate(2026, 3, 20)); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || !c.inBackoff(2026) {
		t.Fatalf("setelah gagal: calls=%d inBackoff=%v, want 1 & true", calls, c.inBackoff(2026))
	}

	healthy = true
	c.FailBackoff = 0
	if _, err := c.HolidaysBetween(context.Background(), ran, domain.NewDate(2026, 3, 20)); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (retry setelah window dibuka)", calls)
	}
	if c.inBackoff(2026) {
		t.Error("sukses harus menghapus fail memory (inBackoff=false)")
	}
}

func TestKresnaStatusCheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()
	k := NewKresna(srv.URL)
	_, err := k.HolidaysBetween(context.Background(), domain.NewDate(2026, 6, 1), domain.NewDate(2026, 6, 30))
	if err == nil {
		t.Fatal("404 harus menghasilkan error")
	}
	if !strings.Contains(err.Error(), "status 404") {
		t.Errorf("err = %v, want mengandung \"status 404\"", err)
	}
}
