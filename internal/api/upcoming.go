package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"wimember/internal/calendarprov"
	"wimember/internal/domain"
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
	// RemindersDefault: the offsets above came from the global default_offsets
	// fallback (no per-contact prefs / per-category override).
	RemindersDefault bool `json:"reminders_default,omitempty"`
}

func (s *Server) handleUpcoming(c *gin.Context) {
	user := mustUser(c)
	ctx := c.Request.Context()
	settings := s.LoadSettings(ctx)

	loc, locErr := time.LoadLocation(settings.Timezone)
	if locErr != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	today := domain.DateFromTime(now)

	// Range: `days` mode (1..90 from today, default 30) or explicit
	// `from`/`to` mode (max 400 days) for calendars that scan across
	// years. An empty `to` means one year from `from`.
	rangeStart, horizon := today, today
	if fromQ := c.Query("from"); fromQ != "" {
		from, err := domain.ParseDate(fromQ)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid from (must be YYYY-MM-DD)"})
			return
		}
		rangeStart = from
		horizon = from.AddDays(365)
		if toQ := c.Query("to"); toQ != "" {
			to, err := domain.ParseDate(toQ)
			if err != nil {
				c.JSON(400, gin.H{"error": "invalid to (must be YYYY-MM-DD)"})
				return
			}
			if to.Before(from) {
				c.JSON(400, gin.H{"error": "inverted range: to < from"})
				return
			}
			horizon = to
		}
		if horizon.JDN()-rangeStart.JDN() > 400 {
			c.JSON(400, gin.H{"error": "range limited to 400 days"})
			return
		}
	} else {
		days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
		if err != nil || days < 1 || days > 90 {
			days = 30
		}
		horizon = today.AddDays(days)
	}

	ownerID := user.ID
	if user.Role == "admin" {
		ownerID = 0
	}
	contacts, err := s.st.ListContacts(ctx, ownerID)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to load contacts"})
		return
	}

	var items []UpcomingItem
	for _, cw := range contacts {
		offsets := settings.DefaultOffsets
		remindersDefault := !(cw.Prefs != nil && cw.Prefs.Enabled && len(cw.Prefs.Offsets) > 0)
		if !remindersDefault {
			offsets = cw.Prefs.Offsets
		}
		for _, occ := range cw.Occasions {
			occs, err := domain.OccurrencesBetween(occ.BaseDate, occ.Type, rangeStart, horizon)
			if err != nil {
				continue
			}
			for _, o := range occs {
				item := UpcomingItem{
					Date: o.Date, Kind: "occasion", OccasionID: occ.ID, ContactID: cw.ID,
					ContactName: cw.Name, Type: string(o.Type), Number: o.Number,
					Title: o.Label, DaysUntil: o.Date.JDN() - today.JDN(), Reminders: offsets,
					RemindersDefault: remindersDefault,
				}
				if occ.Type == domain.Otonan {
					item.Pawukon = domain.Pawukon(o.Date).Label()
				}
				items = append(items, item)
			}
		}
	}

	hs, err := s.multiProvider().HolidaysBetween(ctx, rangeStart, horizon, settings.HolidayCategories)
	if err != nil {
		c.JSON(502, gin.H{"error": "holiday provider failed"})
		return
	}
	for _, h := range hs {
		// Same resolution as the scheduler: per-category offsets, global
		// default fallback (an empty Category also lands on the fallback).
		offs := settings.HolidayOffsets[h.Category]
		remindersDefault := len(offs) == 0
		if remindersDefault {
			offs = settings.DefaultOffsets
		}
		items = append(items, UpcomingItem{Date: h.Date, Kind: "holiday",
			Title: h.Name, DaysUntil: h.Date.JDN() - today.JDN(),
			Reminders: offs, RemindersDefault: remindersDefault})
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
