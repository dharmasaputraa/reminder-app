package notify

import (
	"fmt"

	"otorem/internal/domain"
)

var bulanIndo = [12]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember"}

// hariIndo: Indonesian day names (index = Date.Weekday(),
// 0=Sunday): saptawara Redite=Sunday, Soma=Monday, Anggara=Tuesday, Buda=Wednesday, etc.
var hariIndo = [7]string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}

// TanggalIndo formats "Rabu, 17 Juni 2026" — Indonesian day names: Minggu..Sabtu,
// and Indonesian month names.
func TanggalIndo(d domain.Date) string {
	return fmt.Sprintf("%s, %d %s %d", hariIndo[d.Weekday()], d.Day, bulanIndo[d.Month-1], d.Year)
}

func kapan(daysUntil int) string {
	switch {
	case daysUntil <= 0:
		return "hari ini"
	case daysUntil == 1:
		return "besok"
	default:
		return fmt.Sprintf("%d hari lagi", daysUntil)
	}
}

func holidayEmoji(name string) string {
	switch {
	case name == "Nyepi":
		return "🧘"
	case name == "Galungan" || name == "Kuningan" || name == "Pagerwesi" || name == "Saraswati":
		return "🛕"
	default:
		return "📅"
	}
}

func withLate(body string, late bool) string {
	if late {
		return body + " ⚠️ Terkirim terlambat (perangkat sempat mati)."
	}
	return body
}

func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message {
	var title, body string
	switch occ.Type {
	case domain.Otonan:
		title = fmt.Sprintf("🛕 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("Otonan %s %s, pada %s.", contactName, kapan(daysUntil), TanggalIndo(occ.Date))
	case domain.Birthday:
		title = fmt.Sprintf("🎂 %s ultah ke-%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Ulang tahun ke-%d %s pada %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	default:
		title = fmt.Sprintf("🎊 %s anniversary ke-%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Anniversary ke-%d %s pada %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	}
	p := 5
	if daysUntil <= 0 {
		p = 8
	}
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}

func HolidayMessage(h domain.Holiday, daysUntil int, late bool) Message {
	title := fmt.Sprintf("%s %s %s", holidayEmoji(h.Name), h.Name, kapan(daysUntil))
	body := fmt.Sprintf("%s jatuh pada %s.", h.Name, TanggalIndo(h.Date))
	p := 5
	if daysUntil <= 0 {
		p = 8
	}
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}
