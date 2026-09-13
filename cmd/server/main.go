package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"otorem/internal/api"
	"otorem/internal/calendarprov"
	"otorem/internal/config"
	"otorem/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config tidak valid", "err", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		slog.Error("gagal buat data dir", "dir", cfg.DataDir, "err", err)
		os.Exit(1)
	}
	st, err := store.Open(cfg.DBPath())
	if err != nil {
		slog.Error("gagal buka db", "path", cfg.DBPath(), "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := st.Migrate(); err != nil {
		slog.Error("migrasi gagal", "err", err)
		os.Exit(1)
	}

	providers := []calendarprov.Provider{calendarprov.NewComputedPawukon()}
	srv := api.NewServer(cfg, st, providers)

	httpServer := &http.Server{Addr: cfg.Addr, Handler: srv, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		slog.Info("otorem jalan", "addr", cfg.Addr, "auth", cfg.AuthMode)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	slog.Info("shutdown...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
