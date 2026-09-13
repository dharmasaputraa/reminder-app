package notify

import (
	"strings"
	"testing"

	"otorem/internal/domain"
)

func TestTanggalIndo(t *testing.T) {
	got := TanggalIndo(domain.NewDate(2026, 6, 17))
	if got != "Rabu, 17 Juni 2026" {
		t.Errorf("TanggalIndo = %q", got)
	}
}

func TestOccurrenceMessageOtonan(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Otonan,
		Number: 12, Label: "Otonan ke-12 — Buda Kliwon, Wuku Dunggulan"}
	m := OccurrenceMessage("Made", occ, 3, false)
	if !strings.Contains(m.Title, "🛕") || !strings.Contains(m.Title, "Made") ||
		!strings.Contains(m.Title, "Otonan ke-12") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "3 hari lagi") || !strings.Contains(m.Body, "Rabu, 17 Juni 2026") {
		t.Errorf("body = %q", m.Body)
	}
	if m.Priority != 5 {
		t.Errorf("priority = %d", m.Priority)
	}
}

func TestOccurrenceMessageBirthdayToday(t *testing.T) {
	occ := domain.Occurrence{Date: domain.NewDate(2026, 6, 17), Type: domain.Birthday, Number: 36}
	m := OccurrenceMessage("Budi", occ, 0, false)
	if !strings.Contains(m.Title, "🎂") || !strings.Contains(m.Title, "hari ini") {
		t.Errorf("title = %q", m.Title)
	}
	if m.Priority != 8 {
		t.Errorf("hari ini harus prioritas 8, dapat %d", m.Priority)
	}
}

func TestLateSuffix(t *testing.T) {
	m := OccurrenceMessage("Budi", domain.Occurrence{Date: domain.NewDate(2026, 6, 17),
		Type: domain.Birthday, Number: 30}, 1, true)
	if !strings.Contains(m.Body, "terlambat") {
		t.Errorf("late flag tidak terlihat: %q", m.Body)
	}
}

func TestHolidayMessage(t *testing.T) {
	m := HolidayMessage(domain.Holiday{Date: domain.NewDate(2026, 6, 17), Name: "Galungan"}, 10, false)
	if !strings.Contains(m.Title, "Galungan") || !strings.Contains(m.Title, "10 hari lagi") {
		t.Errorf("title = %q", m.Title)
	}
	if !strings.Contains(m.Body, "Rabu, 17 Juni 2026") {
		t.Errorf("body = %q", m.Body)
	}
}
