// Package notify delivers notifications to Gotify, Telegram, and Email.
// The Notifier interface is implemented by 3 channels; the factory that builds
// notifiers from DB channels lives in factory.go.
package notify

import "context"

type Message struct {
	Title    string
	Body     string
	Priority int // 1..10, Gotify-style; SMTP ignores it
}

type Notifier interface {
	Name() string
	Send(ctx context.Context, msg Message) error
	Test(ctx context.Context) error
}
