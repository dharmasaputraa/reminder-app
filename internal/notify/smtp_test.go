package notify

import (
	"bufio"
	"context"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeSMTP: server SMTP minimal untuk test — cukup protokol dasar
// (220/250/354/221) dan menangkap isi DATA.
type fakeSMTP struct {
	addr     string
	data     string
	mailFrom string
	rcptTo   []string
	quit     func()
}

func startFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeSMTP{addr: ln.Addr().String()}
	done := make(chan struct{})
	f.quit = func() {
		close(done)
		ln.Close()
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				w := bufio.NewWriter(c)
				r := bufio.NewReader(c)
				write := func(s string) {
					w.WriteString(s + "\r\n")
					w.Flush()
				}
				write("220 otorem-test ESMTP")
				inData := false
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					trimmed := strings.TrimRight(line, "\r\n")
					switch {
					case inData:
						if trimmed == "." {
							inData = false
							write("250 OK")
						} else {
							f.data += line
						}
					case strings.HasPrefix(strings.ToUpper(trimmed), "EHLO"),
						strings.HasPrefix(strings.ToUpper(trimmed), "HELO"):
						write("250 otorem-test")
					case strings.HasPrefix(strings.ToUpper(trimmed), "MAIL FROM:"):
						f.mailFrom = trimmed
						write("250 OK")
					case strings.HasPrefix(strings.ToUpper(trimmed), "RCPT TO:"):
						f.rcptTo = append(f.rcptTo, trimmed)
						write("250 OK")
					case strings.HasPrefix(strings.ToUpper(trimmed), "DATA"):
						write("354 end with <CR><LF>.<CR><LF>")
						inData = true
					case strings.HasPrefix(strings.ToUpper(trimmed), "QUIT"):
						write("221 bye")
						return
					default:
						write("250 OK")
					}
				}
			}(conn)
		}
	}()
	t.Cleanup(f.quit)
	return f
}

func TestSMTPSend(t *testing.T) {
	f := startFakeSMTP(t)
	port, _ := strconv.Atoi(strings.Split(f.addr, ":")[1])
	s := NewSMTP(SMTPConfig{Host: "127.0.0.1", Port: port, From: "otorem@x.id",
		To: []string{"budi@x.id"}}) // tanpa auth — fake menerima apa pun
	if err := s.Send(context.Background(), Message{Title: "🎂 ultah", Body: "isi pesan"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.data, "Subject: 🎂 ultah") {
		t.Errorf("subject: %q", f.data)
	}
	if !strings.Contains(f.data, "isi pesan") {
		t.Errorf("body text: %q", f.data)
	}
	if !strings.Contains(f.data, "multipart/alternative") {
		t.Errorf("harus multipart: %q", f.data)
	}
	if len(f.rcptTo) != 1 || !strings.Contains(f.rcptTo[0], "budi@x.id") {
		t.Errorf("rcpt: %v", f.rcptTo)
	}
}

func TestSMTPContextTimeout(t *testing.T) {
	// port yang pasti tidak melayang: koneksi akan gagal/timeout
	s := NewSMTP(SMTPConfig{Host: "127.0.0.1", Port: 1, From: "a@b.c", To: []string{"d@e.f"}})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Send(ctx, Message{Title: "x"}); err == nil {
		t.Error("harus gagal")
	}
}
