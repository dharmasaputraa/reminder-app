package domain

// Pawukon: kalender Bali 210 hari, 10 minggu paralel. v1 hanya butuh
// saptawara (7), pancawara (5), dan wuku (30×7 hari) — lihat spec §5.1.
//
// ANCHOR (satu-satunya konstanta kalender di codebase): 2026-06-17 adalah
// Galungan = Buda Kliwon, Wuku Dunggulan = hari ke-74 siklus. Diverifikasi
// oleh TestPawukonAnchorDates (3 tanggal Galungan terpublikasi) dan fixture
// harian kalenderbali.org (Task 3). Jika test merah, perbaiki HANYA di sini.
var (
	pawukonAnchorJDN      = NewDate(2026, 6, 17).JDN()
	pawukonAnchorCycleDay = 74
)

const PawukonCycleDays = 210

var Saptawara = [7]string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}

// Urutan siklus pancawara: hari ke-1 siklus = Paing (diverifikasi anchor:
// hari-74 = Kliwon → (74-1) mod 5 = 3 → indeks 3 = Kliwon).
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
		Saptawara: d.Weekday(), // saptawara identik hari Gregorian, Redite=Minggu
		Pancawara: (c - 1) % 5,
		Wuku:      (c - 1) / 7,
	}
}

func (p PawukonDate) Label() string {
	return Saptawara[p.Saptawara] + " " + Pancawara[p.Pancawara] + ", Wuku " + Wuku[p.Wuku]
}
