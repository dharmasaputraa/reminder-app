package domain

import (
	"encoding/json"
	"testing"
)

func TestDateJSONRoundTrip(t *testing.T) {
	d := NewDate(2026, 6, 17)
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `"2026-06-17"` {
		t.Errorf("marshal = %s", b)
	}
	var back Date
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if back != d {
		t.Errorf("unmarshal = %s", back)
	}
	if _, err := ParseDate("2026-06-17"); err != nil {
		t.Errorf("ParseDate: %v", err)
	}
	if _, err := ParseDate("17-06-2026"); err == nil {
		t.Error("wrong format must error")
	}
}

func TestParseDateStrict(t *testing.T) {
	for _, s := range []string{"2026-06-17junk", "2026-06-17T10:00", "2026-6-17", "2026-02-30", "17-06-2026"} {
		if _, err := ParseDate(s); err == nil {
			t.Errorf("ParseDate(%q) must error", s)
		}
	}
}
