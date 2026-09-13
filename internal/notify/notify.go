// Package notify: pengiriman notifikasi ke Gotify, Telegram, dan Email.
// Interface Notifier diimplementasi 3 channel; factory dari channel DB ada
// di factory.go.
package notify

import "context"

type Message struct {
	Title    string
	Body     string
	Priority int // 1..10, ala Gotify; SMTP mengabaikan
}

type Notifier interface {
	Name() string
	Send(ctx context.Context, msg Message) error
	Test(ctx context.Context) error
}
