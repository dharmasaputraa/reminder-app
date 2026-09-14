package notify

import (
	"strings"
	"testing"

	"wimember/internal/domain"
)

func TestTanggalIndo(t *testing.T) {
	got := TanggalIndo(domain.NewDate(2026, 6, 17))
	if got != "Wednesday, 17 June 2026" {
		t.Errorf("TanggalIndo = %q", got)
	}
}

func TestOccurrenceMessageOtonan(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Otonan,
		Number: 12, Label: "Otonan #12 — Buda Kliwon, Wuku Dunggulan"}
	m := OccurrenceMessage("Made", occ, 3, false)
	if !strings.Contains(m.Title, "🛕") || !strings.Contains(m.Title, "Made") ||
		!strings.Contains(m.Title, "Otonan #12") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "in 3 days") || !strings.Contains(m.Body, "Wednesday, 17 June 2026") {
		t.Errorf("body = %q", m.Body)
	}
	if m.Priority != 5 {
		t.Errorf("priority = %d", m.Priority)
	}
}

func TestOccurrenceMessageBirthdayToday(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Birthday, Number: 36}
	m := OccurrenceMessage("Budi", occ, 0, false)
	if !strings.Contains(m.Title, "🎂") || !strings.Contains(m.Title, "today") {
		t.Errorf("title = %q", m.Title)
	}
	if m.Priority != 8 {
		t.Errorf("today must have priority 8, got %d", m.Priority)
	}
}

func TestLateSuffix(t *testing.T) {
	m := OccurrenceMessage("Budi", domain.Occurrence{Date: domain.NewDate(2026, 6, 17),
		Type: domain.Birthday, Number: 30}, 1, true)
	if !strings.Contains(m.Body, "Sent late") {
		t.Errorf("late flag not visible: %q", m.Body)
	}
}

func TestHolidayMessage(t *testing.T) {
	m := HolidayMessage(domain.Holiday{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}, 10, false)
	if !strings.Contains(m.Title, "Galungan") || !strings.Contains(m.Title, "in 10 days") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "Wednesday, 17 June 2026") {
		t.Errorf("body = %q", m.Body)
	}
	if m.Priority != 5 {
		t.Errorf("in 10 days must have priority 5, got %d", m.Priority)
	}
	today := HolidayMessage(domain.Holiday{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}, 0, false)
	if today.Priority != 8 {
		t.Errorf("today must have priority 8, got %d", today.Priority)
	}
}
