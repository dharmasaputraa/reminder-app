package api

import "context"

// SchedulerRunnerFunc: adapter closure → api.SchedulerRunner (dipakai main.go).
type SchedulerRunnerFunc func(ctx context.Context) (RunResult, error)

func (f SchedulerRunnerFunc) RunOnce(ctx context.Context) (RunResult, error) { return f(ctx) }
