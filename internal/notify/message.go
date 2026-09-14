package notify

import (
	"fmt"

	"wimember/internal/domain"
)

var bulanIndo = [12]string{"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"}

// hariIndo: day names used by TanggalIndo (index = Date.Weekday(),
// 0=Sunday): saptawara Redite=Sunday, Soma=Monday, Anggara=Tuesday, Buda=Wednesday, etc.
var hariIndo = [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

// TanggalIndo formats "Wednesday, 17 June 2026" — day names Sunday..Saturday,
// and English month names.
func TanggalIndo(d domain.Date) string {
	return fmt.Sprintf("%s, %d %s %d", hariIndo[d.Weekday()], d.Day, bulanIndo[d.Month-1], d.Year)
}

func kapan(daysUntil int) string {
	switch {
	case daysUntil <= 0:
		return "today"
	case daysUntil == 1:
		return "tomorrow"
	default:
		return fmt.Sprintf("in %d days", daysUntil)
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
		return body + " ⚠️ Sent late (device was offline)."
	}
	return body
}

func OccurrenceMessage(contactName string, occ domain.Occurrence, daysUntil int, late bool) Message {
	var title, body string
	switch occ.Type {
	case domain.Otonan:
		title = fmt.Sprintf("🛕 %s — %s %s", contactName, occ.Label, kapan(daysUntil))
		body = fmt.Sprintf("Otonan for %s %s, on %s.", contactName, kapan(daysUntil), TanggalIndo(occ.Date))
	case domain.Birthday:
		title = fmt.Sprintf("🎂 %s — birthday #%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Birthday #%d for %s on %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	default:
		title = fmt.Sprintf("🎊 %s — anniversary #%d %s", contactName, occ.Number, kapan(daysUntil))
		body = fmt.Sprintf("Anniversary #%d for %s on %s.", occ.Number, contactName, TanggalIndo(occ.Date))
	}
	p := 5
	if daysUntil <= 0 {
		p = 8
	}
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}

func HolidayMessage(h domain.Holiday, daysUntil int, late bool) Message {
	title := fmt.Sprintf("%s %s %s", holidayEmoji(h.Name), h.Name, kapan(daysUntil))
	body := fmt.Sprintf("%s falls on %s.", h.Name, TanggalIndo(h.Date))
	p := 5
	if daysUntil <= 0 {
		p = 8
	}
	return Message{Title: title, Body: withLate(body, late), Priority: p}
}
