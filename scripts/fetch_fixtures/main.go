// Scraper fixture: ambil peta tanggal Gregorian → (saptawara, pancawara, wuku)
// dari kalenderbali.org untuk setahun, tulis ke testdata/pawukon_<year>.csv.
// Pemakaian data: fixture pengujian pribadi (spec §6) — data © kalenderbali.org
// (I Wayan Nuarsa, Universitas Udayana), dikreditkan, TIDAK dire distribusikan.
//
// Pemakaian: go run . -year 2026 -out ../../testdata
//
// CATATAN PENYESUAIAN PARSER (kontingensi brief langkah 3): format dayRe
// "dd-mm-yyyy. Sap Pan Wuk" tidak ada di rerainan.php (halaman itu hanya
// berisi daftar hari upacara). Data harian penuh ada di kalender bulanan
// index.php?bulan=N&tanggal=1&tahun=Y: setiap sel <td class="bodikalender|
// libur|liburaktif"> memuat <a title="..."> dengan pawukon hari itu, dalam
// salah satu bentuk:
//
//	title="Sukra Paing Dunggulan"                            (hari polos)
//	title="Penyajaan Galungan (Soma Pon Dunggulan)"          (ada acara)
//	title="Purnama Kasa, Soma Paing Langkir"                 (acara + koma)
//
// Sel <td class="takaktif"> adalah sisa bulan tetangga — dilewati. Ejaan
// sumber: "Keliwon" (bukan "Kliwon") dan "Kasih" pada "Anggara Kasih" (= hari
// Kliwon: posisi situs antara Wage & Umanis di wuku yang sama) — keduanya
// dinormalisasi lewat peta normalize di bawah.
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

// Konstanta nama engine (disalin untuk validasi fail-loud di scraper; engine
// tidak diimpor agar modul scraper tetap terpisah).
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

// ejaan sumber bervariasi; normalisasi ke konstanta engine. Nama yang tidak
// ada di sini DAN tidak cocok konstanta engine = error keras (jangan diam).
var normalize = map[string]string{
	"Keliwon":    "Kliwon",
	"Kasih":      "Kliwon", // "Anggara Kasih" = Anggara Kliwon (terverifikasi posisi situs)
	"Tolu":       "Taulu",
	"Wugu":       "Ugu",
	"Kaulu":      "Kelawu",
	"Kulawu":     "Kelawu",      // varian ejaan wuku-28 di kalenderbali.org
	"Prangbakat": "Parangbakat", // varian ejaan wuku-24 di kalenderbali.org
	"Warigadean": "Warigadian",  // varian ejaan wuku-8 di kalenderbali.org
	"Luang":      "Luang",       // dipertahankan; test akan gagal jika muncul sebagai wuku
}

func norm(s string) string {
	if v, ok := normalize[s]; ok {
		return v
	}
	return s
}

var dayNumRe = regexp.MustCompile(`(\d{1,2})`)
var parenRe = regexp.MustCompile(`\(([A-Za-z]+) ([A-Za-z]+) ([A-Za-z]+)\)`)

// extractPawukon mengambil tripel (saptawara, pancawara, wuku) dari title sel.
// Prioritas: bentuk kurung "Acara (Sap Pan Wuk)", lalu segmen koma yang
// validasi sebagai tripel pawukon — title bisa memuat nama acara 3 kata
// sebelum pawukon ("Hari Siwa Ratri, Saniscara Wage Tambir"). Gagal total =
// error keras.
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
		// kalender bulanan: setiap sel harian memuat pawukon di title
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
			// whitelist sel harian: bodikalender (polos), libur (hari besar),
			// aktif (tanggal yang diminta di URL), liburaktif (keduanya).
			// Kelas lain (takaktif = sisa bulan tetangga, wewaran = legenda
			// samping, wuku/judul*/hari = header) bukan sel harian.
			cls, _ := td.Attr("class")
			if cls != "bodikalender" && cls != "libur" && cls != "aktif" && cls != "liburaktif" {
				return
			}
			a := td.Find(`a[href="javascript:void(0)"]`)
			title, ok := a.Attr("title")
			if !ok || strings.TrimSpace(title) == "" {
				return // bukan sel harian (header, navigasi)
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
			// validasi keras: nama harus konstanta engine setelah normalisasi
			if !saptawara[sap] || !pancawara[pan] || !wuku[wuk] {
				log.Fatalf("%s: nama tak dikenal dari title %q → %s %s %s", date, title, sap, pan, wuk)
			}
			// saptawara == hari Gregorian (definisi); cek silang anti salah petak
			wd := time.Date(*year, time.Month(bulan), atoi(dayM[1]), 0, 0, 0, 0, time.UTC).Weekday()
			if sap != []string{"Redite", "Soma", "Anggara", "Buda", "Wraspati", "Sukra", "Saniscara"}[int(wd)] {
				log.Fatalf("%s: saptawara situs %s ≠ hari Gregorian %v (title %q)", date, sap, wd, title)
			}
			if seenByDate[date] {
				return // duplikat defensif
			}
			seenByDate[date] = true
			rows = append(rows, row{date, sap, pan, wuk})
			bulanRows++
		})
		// jumlah sel harian HARIS sama dengan jumlah hari kalender bulan itu —
		// kurang berarti ada sel yang terlewat diam-diam (struktur berubah?)
		want := time.Date(*year, time.Month(bulan+1), 0, 0, 0, 0, 0, time.UTC).Day()
		if bulanRows != want {
			log.Fatalf("bulan %02d: %d hari terparse, seharusnya %d — sel hilang, jangan lanjut", bulan, bulanRows, want)
		}
		log.Printf("bulan %02d: %d hari", bulan, bulanRows)
		time.Sleep(1500 * time.Millisecond) // sopan: jangan menembak server
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
