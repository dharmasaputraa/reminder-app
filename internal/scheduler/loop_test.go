package scheduler

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestLoopRunsAndStops(t *testing.T) {
	h := newHarness(t, time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC))
	ctx, cancel := context.WithCancel(context.Background())
	called := make(chan struct{}, 1)
	go h.svc.Loop(ctx, 10*time.Millisecond, func(context.Context) (Snapshot, error) {
		select {
		case called <- struct{}{}:
		default:
		}
		return snapUTC(), nil
	})
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("loop tidak pernah menjalankan scan")
	}
	cancel()
	// there is no synchronous way to wait for exit without instrumentation — just make
	// sure there is no panic and the test finishes; the race detector keeps watch.
}

// TestLoopStopsOnCancel: synchronous proof that Loop really stops —
// the 1st snapshot is held (the loop is frozen inside the iteration), ctx is canceled
// before the 2nd tick, then the snapshot is released. When the iteration finishes, only
// ctx.Done is ready in the select (the next tick is still ~1 interval away) → Loop must
// exit without calling snapshot again. If the select does not look at ctx.Done, the
// 500ms tick keeps triggering scans and the count clearly rises above 1.
func TestLoopStopsOnCancel(t *testing.T) {
	h := newHarness(t, time.Date(2026, 6, 17, 8, 2, 0, 0, time.UTC))
	ctx, cancel := context.WithCancel(context.Background())
	var mu sync.Mutex
	calls := 0
	first := make(chan struct{})
	release := make(chan struct{})
	go h.svc.Loop(ctx, 500*time.Millisecond, func(context.Context) (Snapshot, error) {
		mu.Lock()
		calls++
		n := calls
		mu.Unlock()
		if n == 1 {
			close(first)
			<-release // hold the 1st iteration until cancel is in place
		}
		return snapUTC(), nil
	})
	select {
	case <-first:
	case <-time.After(2 * time.Second):
		t.Fatal("loop tidak pernah menjalankan scan")
	}
	cancel()
	close(release)
	// Wait 3 tick intervals: a correct loop does not call snapshot again;
	// a wrong loop keeps scanning every 500ms (≥3 extra calls).
	time.Sleep(1500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Errorf("loop masih jalan setelah ctx cancel: snapshot dipanggil %d kali", calls)
	}
}
