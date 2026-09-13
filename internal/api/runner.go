package api

import "context"

// SchedulerRunnerFunc adapts a closure to api.SchedulerRunner (used by main.go).
type SchedulerRunnerFunc func(ctx context.Context) (RunResult, error)

func (f SchedulerRunnerFunc) RunOnce(ctx context.Context) (RunResult, error) { return f(ctx) }
