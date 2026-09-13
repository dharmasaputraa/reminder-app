package domain

import "fmt"

// HolidayDef: satu hari raya Pawukon = kombinasi (saptawara, pancawara, wuku).
type HolidayDef struct {
	Name      string
	Saptawara int
	Pancawara int
	Wuku      int
}

// HANYA definisi yang sudah baku dan diverifikasi (spec §5.3). Menambah
// definisi (deret Tumpek, Sugihan, dsb.) WAJIB: tambahkan baris di fixture
// scraper terlebih dahulu, buktikan tanggalnya cocok, baru masuk sini.
var PawukonHolidayDefs = []HolidayDef{
	{Name: "Galungan", Saptawara: 3, Pancawara: 3, Wuku: 10},  // Buda Kliwon Dunggulan
	{Name: "Kuningan", Saptawara: 6, Pancawara: 3, Wuku: 11},  // Saniscara Kliwon Kuningan
	{Name: "Saraswati", Saptawara: 6, Pancawara: 4, Wuku: 29}, // Saniscara Umanis Watugunung
	{Name: "Pagerwesi", Saptawara: 3, Pancawara: 3, Wuku: 0},  // Buda Kliwon Sinta
}

type Holiday struct {
	Date Date
	Name string
}

// PawukonHolidaysBetween returns Pawukon-based holidays in [from, to].
// O( jumlah hari × jumlah definisi ) — trivial untuk rentang horizon app.
func PawukonHolidaysBetween(from, to Date) []Holiday {
	var out []Holiday
	for d := from; !d.After(to); d = d.AddDays(1) {
		p := Pawukon(d)
		for _, h := range PawukonHolidayDefs {
			if p.Saptawara == h.Saptawara && p.Pancawara == h.Pancawara && p.Wuku == h.Wuku {
				out = append(out, Holiday{Date: d, Name: h.Name})
				break
			}
		}
	}
	return out
}

func (h Holiday) String() string { return fmt.Sprintf("%s (%s)", h.Name, h.Date) }
