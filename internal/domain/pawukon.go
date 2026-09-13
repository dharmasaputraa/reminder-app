package domain

// Pawukon: the Balinese 210-day calendar with 10 parallel weeks. v1 only needs
// saptawara (7), pancawara (5), and wuku (30×7 days) — see spec §5.1.
//
// ANCHOR (the only calendar constant in the codebase): 2026-06-17 is
// Galungan = Buda Kliwon, Wuku Dunggulan = day 74 of the cycle. Verified
// by TestPawukonAnchorDates (3 published Galungan dates) and the daily
// kalenderbali.org fixture (Task 3). If the test goes red, fix it ONLY here.
var (
	pawukonAnchorJDN      = NewDate(2026, 6, 17).JDN()
	pawukonAnchorCycleDay = 74
)

const PawukonCycleDays = 210

var Saptawara = [7]string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}

// Pancawara cycle order: day 1 of the cycle = Paing (verified by the anchor:
// day 74 = Kliwon → (74-1) mod 5 = 3 → index 3 = Kliwon).
var Pancawara = [5]string{"Paing", "Pon", "Wage", "Kliwon", "Umanis"}

var Wuku = [30]string{
	"Sinta", "Landep", "Ukir", "Kulantir", "Taulu", "Gumbreg", "Wariga",
	"Warigadian", "Julungwangi", "Sungsang", "Dunggulan", "Kuningan", "Langkir",
	"Medangsia", "Pujut", "Pahang", "Krulut", "Merakih", "Tambir", "Medangkungan",
	"Matal", "Uye", "Menail", "Parangbakat", "Bala", "Ugu", "Wayang", "Kelawu",
	"Dukut", "Watugunung",
}

type PawukonDate struct {
	Saptawara int // 0=Redite … 6=Saniscara (== Date.Weekday())
	Pancawara int // 0=Paing … 4=Umanis
	Wuku      int // 0=Sinta … 29=Watugunung
}

// CycleDay returns the day within the Pawukon cycle: 1..210.
func CycleDay(d Date) int {
	off := (d.JDN() - pawukonAnchorJDN + pawukonAnchorCycleDay - 1) % PawukonCycleDays
	if off < 0 {
		off += PawukonCycleDays
	}
	return off + 1
}

func Pawukon(d Date) PawukonDate {
	c := CycleDay(d)
	return PawukonDate{
		Saptawara: d.Weekday(), // saptawara is identical to the Gregorian weekday, Redite=Sunday
		Pancawara: (c - 1) % 5,
		Wuku:      (c - 1) / 7,
	}
}

func (p PawukonDate) Label() string {
	return Saptawara[p.Saptawara] + " " + Pancawara[p.Pancawara] + ", Wuku " + Wuku[p.Wuku]
}
