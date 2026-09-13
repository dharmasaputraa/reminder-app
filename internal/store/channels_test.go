package store

import (
	"context"
	"errors"
	"testing"
)

func TestChannelOwnerScope(t *testing.T) {
	s, err := OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	a, _ := s.GetOrCreateUser(ctx, "a@x.id", "A", nil)
	b, _ := s.GetOrCreateUser(ctx, "b@x.id", "B", nil)
	chB, err := s.CreateChannel(ctx, b.ID, "gotify", "channel-B", []byte(`{"x":1}`))
	if err != nil {
		t.Fatal(err)
	}

	// owner A cannot toggle/delete B's channel (IDOR)
	if err := s.SetChannelEnabled(ctx, a.ID, chB.ID, false); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A toggle channel B harus ErrNotFound, dapat %v", err)
	}
	if err := s.DeleteChannel(ctx, a.ID, chB.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A hapus channel B harus ErrNotFound, dapat %v", err)
	}

	// owner B manages their own channel: allowed
	if err := s.SetChannelEnabled(ctx, b.ID, chB.ID, false); err != nil {
		t.Fatalf("owner B toggle channel sendiri gagal: %v", err)
	}
	ch, err := s.GetChannel(ctx, b.ID, chB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Enabled {
		t.Errorf("enabled=false tidak tersimpan: %+v", ch)
	}

	// admin (ownerID 0) can toggle + delete anyone's channel,
	// consistent with the 0=admin convention in GetChannel/ListChannels
	if err := s.SetChannelEnabled(ctx, 0, chB.ID, true); err != nil {
		t.Errorf("admin toggle channel harus bisa, dapat %v", err)
	}
	ch, err = s.GetChannel(ctx, 0, chB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ch.Enabled {
		t.Errorf("admin toggle: enabled=true tidak tersimpan: %+v", ch)
	}
	if err := s.DeleteChannel(ctx, 0, chB.ID); err != nil {
		t.Errorf("admin hapus channel harus bisa, dapat %v", err)
	}

	// channel is really deleted: B deletes again → ErrNotFound
	if err := s.DeleteChannel(ctx, b.ID, chB.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("channel sudah terhapus, harus ErrNotFound, dapat %v", err)
	}
}
