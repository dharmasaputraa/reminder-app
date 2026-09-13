package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSchedulerRunEndpointWithRunner(t *testing.T) {
	s, _ := newTestServer(t, "admin@x.id")
	s.SetRunner(SchedulerRunnerFunc(func(ctx context.Context) (RunResult, error) {
		return RunResult{Sent: 2, Failed: 1, Missed: 3}, nil
	}))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "admin@x.id", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"sent":2`) {
		t.Errorf("run: %d %s", w.Code, w.Body.String())
	}
	// non-admin → 403
	w = httptest.NewRecorder()
	s.ServeHTTP(w, devReq(t, "POST", "/api/v1/scheduler/run", "member@x.id", ""))
	if w.Code != 403 {
		t.Errorf("non-admin: %d", w.Code)
	}
}
