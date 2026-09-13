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
	// tidak ada cara sinkron menunggu exit tanpa instrumentasi — cukup pastikan
	// tidak panic dan test selesai; race detector yang menjaga.
}

// TestLoopStopsOnCancel: bukti sinkron bahwa Loop benar-benar berhenti —
// snapshot ke-1 ditahan (loop beku di dalam iterasi), ctx di-cancel sebelum
// tick ke-2, lalu snapshot dilepas. Saat iterasi selesai, hanya ctx.Done yang
// siap di select (tick berikutnya masih ~1 interval jauh) → Loop wajib keluar
// tanpa memanggil snapshot lagi. Jika select tidak menengok ctx.Done, tick
// 500ms terus memicu scan dan hitungan naik jelas di atas 1.
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
			<-release // tahan iterasi ke-1 sampai cancel terpasang
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
	// Tunggu 3 interval tick: loop yang benar tidak memanggil snapshot lagi;
	// loop yang salah terus scan tiap 500ms (≥3 panggilan tambahan).
	time.Sleep(1500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Errorf("loop masih jalan setelah ctx cancel: snapshot dipanggil %d kali", calls)
	}
}
