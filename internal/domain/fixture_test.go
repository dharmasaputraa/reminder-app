package domain

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func indexOf(list []string, name string) int {
	for i, s := range list {
		if s == name {
			return i
		}
	}
	return -1
}

func TestPawukonAgainstFixtures(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("..", "..", "testdata", "pawukon_*.csv"))
	if len(files) == 0 {
		t.Skip("fixture not present — run scripts/fetch_fixtures")
	}
	for _, file := range files {
		f, err := os.Open(file)
		if err != nil {
			t.Fatal(err)
		}
		rows, err := csv.NewReader(f).ReadAll()
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		for i, row := range rows {
			if i == 0 {
				continue
			}
			var y, m, d int
			if _, err := fmt.Sscanf(row[0], "%d-%d-%d", &y, &m, &d); err != nil {
				t.Fatalf("%s line %d: %v", file, i+1, err)
			}
			got := Pawukon(NewDate(y, m, d))
			wantSap, wantPan, wantWuk := row[1], row[2], row[3]
			if Saptawara[got.Saptawara] != wantSap || Pancawara[got.Pancawara] != wantPan || Wuku[got.Wuku] != wantWuk {
				t.Errorf("%s: engine=%s | fixture=%s %s %s", row[0], got.Label(), wantSap, wantPan, wantWuk)
			}
		}
	}
}

func TestFixtureSpellingKnown(t *testing.T) {
	// fixture spelling must exactly match the engine constants (normalization happens in the scraper)
	for _, n := range strings.Split("Kliwon,Umanis,Dunggulan,Watugunung", ",") {
		if indexOf(Wuku[:], n) < 0 && indexOf(Pancawara[:], n) < 0 {
			t.Errorf("name %q not known to engine", n)
		}
	}
}
