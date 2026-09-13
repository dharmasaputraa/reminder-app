package domain

import "testing"

func TestReminderDates(t *testing.T) {
	occ := NewDate(2026, 6, 17)
	want := []Date{NewDate(2026, 6, 10), NewDate(2026, 6, 13), NewDate(2026, 6, 15), NewDate(2026, 6, 16), NewDate(2026, 6, 17)}
	got, err := ReminderDates(occ, DefaultOffsets)
	if err != nil {
		t.Fatal(err)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d]=%s want %s", i, got[i], want[i])
		}
	}
}

func TestReminderDatesDedupeSort(t *testing.T) {
	got, err := ReminderDates(NewDate(2026, 6, 17), []int{2, 7, 2, 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("dapat %d tanggal, want 3 (dedupe): %v", len(got), got)
	}
	if got[0] != NewDate(2026, 6, 10) || got[2] != NewDate(2026, 6, 17) {
		t.Errorf("urutan salah: %v", got)
	}
}

func TestValidateOffsets(t *testing.T) {
	if err := ValidateOffsets([]int{-1}); err == nil {
		t.Error("offset negatif harus error")
	}
	if err := ValidateOffsets([]int{1, 1, 500}); err == nil {
		t.Error("duplikat/terlalu besar harus error")
	}
	if err := ValidateOffsets(DefaultOffsets); err != nil {
		t.Errorf("default harus valid: %v", err)
	}
}
