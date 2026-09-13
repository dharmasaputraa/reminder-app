package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"otorem/internal/calendarprov"
	"otorem/internal/domain"
)

type UpcomingItem struct {
	Date        domain.Date `json:"date"`
	Kind        string      `json:"kind"` // "occasion" | "holiday"
	OccasionID  int64       `json:"occasion_id,omitempty"`
	ContactID   int64       `json:"contact_id,omitempty"`
	ContactName string      `json:"contact_name,omitempty"`
	Type        string      `json:"type,omitempty"`
	Number      int         `json:"number,omitempty"`
	Title       string      `json:"title"`
	Pawukon     string      `json:"pawukon,omitempty"`
	DaysUntil   int         `json:"days_until"`
	Reminders   []int       `json:"reminders,omitempty"`
}

func (s *Server) handleUpcoming(c *gin.Context) {
	user := mustUser(c)
	ctx := c.Request.Context()
	settings := s.LoadSettings(ctx)

	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	if err != nil || days < 1 || days > 90 {
		days = 30
	}
	loc, locErr := time.LoadLocation(settings.Timezone)
	if locErr != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	today := domain.DateFromTime(now)
	horizon := today.AddDays(days)

	ownerID := user.ID
	if user.Role == "admin" {
		ownerID = 0
	}
	contacts, err := s.st.ListContacts(ctx, ownerID)
	if err != nil {
		c.JSON(500, gin.H{"error": "gagal memuat kontak"})
		return
	}

	var items []UpcomingItem
	for _, cw := range contacts {
		offsets := settings.DefaultOffsets
		if cw.Prefs != nil && cw.Prefs.Enabled && len(cw.Prefs.Offsets) > 0 {
			offsets = cw.Prefs.Offsets
		}
		for _, occ := range cw.Occasions {
			occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, today, horizon)
			if err != nil {
				continue
			}
			for _, o := range occs {
				item := UpcomingItem{
					Date: o.Date, Kind: "occasion", OccasionID: occ.ID, ContactID: cw.ID,
					ContactName: cw.Name, Type: string(o.Type), Number: o.Number,
					Title: o.Label, DaysUntil: o.Date.JDN() - today.JDN(), Reminders: offsets,
				}
				if occ.Type == domain.Otonan {
					item.Pawukon = domain.Pawukon(o.Date).Label()
				}
				items = append(items, item)
			}
		}
	}

	hs, err := s.multiProvider().HolidaysBetween(ctx, today, horizon, settings.HolidayCategories)
	if err != nil {
		c.JSON(502, gin.H{"error": "provider hari raya gagal"})
		return
	}
	for _, h := range hs {
		items = append(items, UpcomingItem{Date: h.Date, Kind: "holiday",
			Title: h.Name, DaysUntil: h.Date.JDN() - today.JDN()})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Date != items[j].Date {
			return items[i].Date.Before(items[j].Date)
		}
		return items[i].Kind < items[j].Kind
	})
	c.JSON(http.StatusOK, gin.H{"today": today.String(), "items": items})
}

func (s *Server) multiProvider() calendarprov.MultiProvider {
	return calendarprov.MultiProvider{Providers: s.providers}
}
