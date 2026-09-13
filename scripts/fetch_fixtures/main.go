// Fixture scraper: fetches the Gregorian date → (saptawara, pancawara, wuku) map
// from kalenderbali.org for one year, writes it to testdata/pawukon_<year>.csv.
// Data usage: private test fixtures (spec §6) — data © kalenderbali.org
// (I Wayan Nuarsa, Udayana University), credited, NOT redistributed.
//
// Usage: go run . -year 2026 -out ../../testdata
//
// PARSER ADJUSTMENT NOTES (brief step 3 contingency): the dayRe format
// "dd-mm-yyyy. Sap Pan Wuk" does not exist in rerainan.php (that page only
// lists ceremony days). The full daily data lives in the monthly calendar
// index.php?bulan=N&tanggal=1&tahun=Y: every <td class="bodikalender|
// libur|liburaktif"> cell contains <a title="..."> with that day's pawukon,
// in one of these forms:
//
//	title="Sukra Paing Dunggulan"                            (plain day)
//	title="Penyajaan Galungan (Soma Pon Dunggulan)"          (has an event)
//	title="Purnama Kasa, Soma Paing Langkir"                 (event + comma)
//
// Cells <td class="takaktif"> are leftover days from neighboring months — skipped.
// Source spelling: "Keliwon" (not "Kliwon") and "Kasih" in "Anggara Kasih" (= a
// Kliwon day: the site's position between Wage & Umanis in the same wuku) — both
// are normalized through the normalize map below.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// Engine name constants (copied for fail-loud validation in the scraper; the
// engine is not imported so the scraper module stays separate).
var (
	saptawara = map[string]bool{"Redite": true, "Soma": true, "Anggara": true, "Buda": true, "Wraspati": true, "Sukra": true, "Saniscara": true}
	pancawara = map[string]bool{"Paing": true, "Pon": true, "Wage": true, "Kliwon": true, "Umanis": true}
	wuku      = map[string]bool{
		"Sinta": true, "Landep": true, "Ukir": true, "Kulantir": true, "Taulu": true,
		"Gumbreg": true, "Wariga": true, "Warigadian": true, "Julungwangi": true,
		"Sungsang": true, "Dunggulan": true, "Kuningan": true, "Langkir": true,
		"Medangsia": true, "Pujut": true, "Pahang": true, "Krulut": true,
		"Merakih": true, "Tambir": true, "Medangkungan": true, "Matal": true,
		"Uye": true, "Menail": true, "Parangbakat": true, "Bala": true,
		"Ugu": true, "Wayang": true, "Kelawu": true, "Dukut": true,
		"Watugunung": true,
	}
)

// source spelling varies; normalize to the engine constants. A name that is
// not here AND does not match the engine constants = hard error (don't stay silent).
var normalize = map[string]string{
	"Keliwon":    "Kliwon",
	"Kasih":      "Kliwon", // "Anggara Kasih" = Anggara Kliwon (site position verified)
	"Tolu":       "Taulu",
	"Wugu":       "Ugu",
	"Kaulu":      "Kelawu",
	"Kulawu":     "Kelawu",      // spelling variant of wuku 28 on kalenderbali.org
	"Prangbakat": "Parangbakat", // spelling variant of wuku 24 on kalenderbali.org
	"Warigadean": "Warigadian",  // spelling variant of wuku 8 on kalenderbali.org
	"Luang":      "Luang",       // kept; the test will fail if it shows up as a wuku
}

func norm(s string) string {
	if v, ok := normalize[s]; ok {
		return v
	}
	return s
}

var dayNumRe = regexp.MustCompile(`(\d{1,2})`)
var parenRe = regexp.MustCompile(`\(([A-Za-z]+) ([A-Za-z]+) ([A-Za-z]+)\)`)

// extractPawukon extracts the (saptawara, pancawara, wuku) triple from a cell title.
// Priority: the parenthesized form "Event (Sap Pan Wuk)", then comma segments that
// validate as a pawukon triple — the title may contain a 3-word event name
// before the pawukon ("Hari Siwa Ratri, Saniscara Wage Tambir"). Total failure =
// hard error.
func extractPawukon(title string) (string, string, string, error) {
	valid := func(sap, pan, wuk string) bool {
		sap, pan, wuk = norm(sap), norm(pan), norm(wuk)
		return saptawara[sap] && pancawara[pan] && wuku[wuk]
	}
	if m := parenRe.FindStringSubmatch(title); m != nil {
		if valid(m[1], m[2], m[3]) {
			return m[1], m[2], m[3], nil
		}
	}
	for _, seg := range strings.Split(title, ",") {
		words := strings.Fields(seg)
		if len(words) == 3 && valid(words[0], words[1], words[2]) {
			return words[0], words[1], words[2], nil
		}
	}
	return "", "", "", fmt.Errorf("tidak ada pawukon valid di title %q", title)
}

type row struct {
	date string // YYYY-MM-DD
	sap  string
	pan  string
	wuk  string
}

func main() {
	year := flag.Int("year", time.Now().Year(), "tahun kalender")
	out := flag.String("out", "../../testdata", "direktori output CSV")
	flag.Parse()

	f, err := os.Create(fmt.Sprintf("%s/pawukon_%d.csv", *out, *year))
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	fmt.Fprintln(f, "date,saptawara,pancawara,wuku")

	client := &http.Client{Timeout: 20 * time.Second}
	var rows []row
	seenByDate := map[string]bool{}
	for bulan := 1; bulan <= 12; bulan++ {
		// monthly calendar: every daily cell carries the pawukon in its title
		url := fmt.Sprintf("https://kalenderbali.org/index.php?bulan=%d&tanggal=1&tahun=%d", bulan, *year)
		resp, err := client.Get(url)
		if err != nil {
			log.Fatalf("GET %s: %v", url, err)
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			log.Fatalf("GET %s: status %d", url, resp.StatusCode)
		}
		doc, err := goquery.NewDocumentFromReader(resp.Body)
		resp.Body.Close()
		if err != nil {
			log.Fatal(err)
		}

		bulanRows := 0
		doc.Find("td").Each(func(_ int, td *goquery.Selection) {
			// whitelist of daily cells: bodikalender (plain), libur (public holiday),
			// aktif (the date requested in the URL), liburaktif (both).
			// Other classes (takaktif = leftover from neighboring months, wewaran = side
			// legend, wuku/judul*/hari = header) are not daily cells.
			cls, _ := td.Attr("class")
			if cls != "bodikalender" && cls != "libur" && cls != "aktif" && cls != "liburaktif" {
				return
			}
			a := td.Find(`a[href="javascript:void(0)"]`)
			title, ok := a.Attr("title")
			if !ok || strings.TrimSpace(title) == "" {
				return // not a daily cell (header, navigation)
			}
			dayM := dayNumRe.FindStringSubmatch(strings.TrimSpace(td.Text()))
			if dayM == nil {
				return
			}
			sap, pan, wuk, err := extractPawukon(title)
			if err != nil {
				log.Fatalf("bulan %d: %v", bulan, err)
			}
			sap, pan, wuk = norm(sap), norm(pan), norm(wuk)

			date := fmt.Sprintf("%04d-%02d-%02s", *year, bulan, dayM[1])
			// hard validation: names must be engine constants after normalization
			if !saptawara[sap] || !pancawara[pan] || !wuku[wuk] {
				log.Fatalf("%s: nama tak dikenal dari title %q → %s %s %s", date, title, sap, pan, wuk)
			}
			// saptawara == Gregorian weekday (by definition); cross-check against misaligned cells
			wd := time.Date(*year, time.Month(bulan), atoi(dayM[1]), 0, 0, 0, 0, time.UTC).Weekday()
			if sap != []string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}[int(wd)] {
				log.Fatalf("%s: saptawara situs %s ≠ hari Gregorian %v (title %q)", date, sap, wd, title)
			}
			if seenByDate[date] {
				return // defensive duplicate
			}
			seenByDate[date] = true
			rows = append(rows, row{date, sap, pan, wuk})
			bulanRows++
		})
		// the number of daily cells MUST equal the number of calendar days in that month —
		// fewer means a cell was silently missed (did the structure change?)
		want := time.Date(*year, time.Month(bulan+1), 0, 0, 0, 0, 0, time.UTC).Day()
		if bulanRows != want {
			log.Fatalf("bulan %02d: %d hari terparse, seharusnya %d — sel hilang, jangan lanjut", bulan, bulanRows, want)
		}
		log.Printf("bulan %02d: %d hari", bulan, bulanRows)
		time.Sleep(1500 * time.Millisecond) // polite: don't hammer the server
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].date < rows[j].date })
	for _, r := range rows {
		fmt.Fprintf(f, "%s,%s,%s,%s\n", r.date, r.sap, r.pan, r.wuk)
	}
	log.Printf("total baris: %d → %s/pawukon_%d.csv", len(rows), *out, *year)
	if len(rows) < 350 {
		log.Fatalf("baris %d < 350 — kemungkinan struktur HTML berubah; curl halaman & sesuaikan parser", len(rows))
	}
}

func atoi(s string) int {
	var n int
	fmt.Sscanf(s, "%d", &n)
	return n
}
