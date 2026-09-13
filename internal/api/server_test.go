package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"otorem/internal/config"
	"otorem/internal/domain"
	"otorem/internal/store"
)

func newTestServer(t *testing.T, admin string) (*Server, *store.Store) {
	t.Helper()
	ginSet(t)
	st, err := store.OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.Migrate(); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AppSecret: "super-secret-panjang-16", AuthMode: config.AuthDev,
		AdminEmails: map[string]bool{admin: true}, TZ: "Asia/Jakarta"}
	return NewServer(cfg, st, nil), st
}

func ginSet(t *testing.T) { gin.SetMode(gin.TestMode) } // via import gin

func devReq(t *testing.T, method, target, email, body string) *http.Request {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Dev-Email", email)
	return req
}

func TestContactFlow(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", "admin@x.id",
		`{"name":"Made","nickname":"De","notes":"sepupu"}`))
	if w.Code != 201 {
		t.Fatalf("create contact: %d %s", w.Code, w.Body.String())
	}

	// Otonan base = today − 210 → occurrence ke-1 jatuh TEPAT hari ini; deterministik
	// untuk window 30 hari (tanggal acak sering jatuh di luar window → flaky).
	// Pin ke TZ server (Asia/Jakarta, sesuai DefaultSettings) — bukan TZ mesin —
	// agar deterministik di semua zona waktu.
	loc, _ := time.LoadLocation("Asia/Jakarta")
	today := domain.DateFromTime(time.Now().In(loc))
	base := today.AddDays(-domain.PawukonCycleDays)
	ocBody, _ := json.Marshal(map[string]string{"type": "otongan", "date": base.String()})
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/1/occasions", "admin@x.id", string(ocBody)))
	if w.Code != 201 {
		t.Fatalf("add occasion: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming?days=30", "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatalf("upcoming: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"kind":"occasion"`) || !strings.Contains(w.Body.String(), `"pawukon"`) {
		t.Errorf("upcoming tidak memuat occasion+pawukon: %s", w.Body.String())
	}
}

func TestUpcomingEmpty(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/upcoming", "admin@x.id", ""))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var out struct {
		Items []UpcomingItem `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	// boleh kosong atau berisi holiday pawukon; tidak boleh error
	_ = out
}

func TestPawukonEndpoint(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/pawukon?date=2026-06-17", "admin@x.id", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Buda Kliwon, Wuku Dunggulan") {
		t.Errorf("pawukon: %d %s", w.Code, w.Body.String())
	}
}

func TestChannelConfigNeverLeaked(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/channels", "admin@x.id",
		`{"type":"gotify","name":"rumah","config":{"base_url":"https://g.x.id","token":"TOKET-RAHASIA"}}`))
	if w.Code != 201 {
		t.Fatalf("create channel: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "GET", "/api/v1/channels", "admin@x.id", ""))
	if strings.Contains(w.Body.String(), "TOKET-RAHASIA") {
		t.Error("config channel bocor di response!")
	}
}

func TestSettingsValidate(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Asia/Makassar","send_time":"07:30","catch_up_hours":12,"default_offsets":[3,1,0],"holiday_categories":{"pawukon":true}}`))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"catch_up_hours":12`) {
		t.Errorf("save settings: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Tidak/Ada","send_time":"07:30","catch_up_hours":12,"default_offsets":[1],"holiday_categories":{}}`))
	if w.Code != 400 {
		t.Errorf("tz invalid harus 400: %d", w.Code)
	}
}

func TestSettingsMissingCategories(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	// PUT tanpa holiday_categories → 200 (tidak panic), ketiga kategori terisi
	// sesuai semantik brief: kategori yang tidak dikirim → false.
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "PUT", "/api/v1/settings", "admin@x.id",
		`{"timezone":"Asia/Jakarta","send_time":"08:00","catch_up_hours":24,"default_offsets":[7,4,2,1,0]}`))
	if w.Code != 200 {
		t.Fatalf("put tanpa holiday_categories: %d %s", w.Code, w.Body.String())
	}
	var got Settings
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	for _, cat := range []string{"pawukon", "saka", "national"} {
		v, ok := got.HolidayCategories[cat]
		if !ok {
			t.Errorf("kategori %q tidak ada di response", cat)
		} else if v {
			t.Errorf("kategori %q harus false (tidak dikirim), dapat %v", cat, v)
		}
	}
}

func TestAddOccasionInvalidType(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts", "admin@x.id", `{"name":"Made"}`))
	if w.Code != 201 {
		t.Fatalf("create contact: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/contacts/1/occasions", "admin@x.id",
		`{"type":"salfok","date":"1990-05-12"}`))
	if w.Code != 400 {
		t.Errorf("tipe occasion ilegal harus 400, dapat %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "tipe occasion tidak valid") {
		t.Errorf("pesan error salah: %s", w.Body.String())
	}
}

func TestDefaultSettingsDefensiveCopy(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	ds := DefaultSettings()
	ds.DefaultOffsets[0] = 99
	ls := srv.LoadSettings(context.Background())
	ls.DefaultOffsets[0] = 99
	if domain.DefaultOffsets[0] != 7 {
		t.Errorf("domain.DefaultOffsets termutasi via api.Settings: %v", domain.DefaultOffsets)
	}
}

func TestSchedulerRunWithoutRunner(t *testing.T) {
	srv, _ := newTestServer(t, "admin@x.id")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "admin@x.id", ""))
	if w.Code != 503 {
		t.Errorf("tanpa runner: %d", w.Code)
	}
	_ = context.Background()
}
