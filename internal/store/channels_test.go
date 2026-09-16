package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
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
	if _, err := uuid.Parse(chB.ID); err != nil {
		t.Fatalf("channel id not a uuid: %v", chB.ID)
	}

	// owner A cannot toggle/delete B's channel (IDOR)
	if err := s.SetChannelEnabled(ctx, a.ID, chB.ID, false); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A toggling B's channel must be ErrNotFound, got %v", err)
	}
	if err := s.DeleteChannel(ctx, a.ID, chB.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("owner A deleting B's channel must be ErrNotFound, got %v", err)
	}

	// owner B manages their own channel: allowed
	if err := s.SetChannelEnabled(ctx, b.ID, chB.ID, false); err != nil {
		t.Fatalf("owner B toggling own channel failed: %v", err)
	}
	ch, err := s.GetChannel(ctx, b.ID, chB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Enabled {
		t.Errorf("enabled=false not stored: %+v", ch)
	}

	// admin (ownerID "") can toggle + delete anyone's channel,
	// consistent with the ""=admin convention in GetChannel/ListChannels
	if err := s.SetChannelEnabled(ctx, "", chB.ID, true); err != nil {
		t.Errorf("admin must be able to toggle channel, got %v", err)
	}
	ch, err = s.GetChannel(ctx, "", chB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ch.Enabled {
		t.Errorf("admin toggle: enabled=true not stored: %+v", ch)
	}
	if err := s.DeleteChannel(ctx, "", chB.ID); err != nil {
		t.Errorf("admin must be able to delete channel, got %v", err)
	}

	// channel is really deleted: B deletes again → ErrNotFound
	if err := s.DeleteChannel(ctx, b.ID, chB.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("channel already deleted, must be ErrNotFound, got %v", err)
	}
}
