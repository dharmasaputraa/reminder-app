package scheduler

import (
	"context"
	"log/slog"
	"time"
)

// Loop runs a per-minute ticker; the settings snapshot is taken on every
// iteration so Settings changes (timezone/send time/catch-up) apply without a restart.
func (s *Service) Loop(ctx context.Context, every time.Duration,
	snapshot func(context.Context) (Snapshot, error)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			snap, err := snapshot(ctx)
			if err != nil {
				slog.Error("scheduler: snapshot settings gagal", "err", err)
				continue
			}
			if res, err := s.RunOnce(ctx, snap); err != nil {
				slog.Error("scheduler: runonce gagal", "err", err)
			} else if res.Sent+res.Failed+res.Missed > 0 {
				slog.Info("scheduler: scan", "sent", res.Sent, "failed", res.Failed, "missed", res.Missed)
			}
		}
	}
}
