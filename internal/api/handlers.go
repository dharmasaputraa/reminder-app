package api

import (
	"encoding/json"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"wimember/internal/domain"
	"wimember/internal/secret"
	"wimember/internal/store"
)

func bind[T any](c *gin.Context) (*T, bool) {
	var v T
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return nil, false
	}
	return &v, true
}

func respondErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		c.JSON(404, gin.H{"error": "not found"})
	default:
		c.JSON(500, gin.H{"error": err.Error()})
	}
}

// pathID: ids are UUIDs; a malformed one can never exist, so it is a 404
// (not a 400) — the route's resource simply is not there.
func pathID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(404, gin.H{"error": "not found"})
		return "", false
	}
	return id, true
}

func (s *Server) handleMe(c *gin.Context) {
	u := mustUser(c)
	c.JSON(200, gin.H{"email": u.Email, "name": u.Name, "role": u.Role})
}

type contactIn struct {
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Notes    string `json:"notes"`
}

// scope: the owner filter for store calls — the caller's own id, or "" for
// admins (the store treats "" as "no owner filter").
func (s *Server) scope(c *gin.Context) string {
	u := mustUser(c)
	if u.Role == "admin" {
		return ""
	}
	return u.ID
}

func (s *Server) handleListContacts(c *gin.Context) {
	list, err := s.st.ListContacts(c.Request.Context(), s.scope(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"contacts": list})
}

func (s *Server) handleCreateContact(c *gin.Context) {
	in, ok := bind[contactIn](c)
	if !ok {
		return
	}
	if in.Name == "" {
		c.JSON(400, gin.H{"error": "name is required"})
		return
	}
	ct, err := s.st.CreateContact(c.Request.Context(), mustUser(c).ID, in.Name, in.Nickname, in.Notes)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(201, store.ContactWithOccasions{Contact: ct, Occasions: []store.Occasion{}, Prefs: nil})
}

func (s *Server) handleGetContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	cw, err := s.st.GetContact(c.Request.Context(), s.scope(c), id)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, cw)
}

func (s *Server) handleUpdateContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	in, ok := bind[contactIn](c)
	if !ok {
		return
	}
	if err := s.st.UpdateContact(c.Request.Context(), s.scope(c), id, in.Name, in.Nickname, in.Notes); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) handleDeleteContact(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := s.st.DeleteContact(c.Request.Context(), s.scope(c), id); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

type occasionIn struct {
	Type  string `json:"type"`
	Date  string `json:"date"` // YYYY-MM-DD
	Label string `json:"label"`
}

func (s *Server) handleAddOccasion(c *gin.Context) {
	cid, ok := pathID(c)
	if !ok {
		return
	}
	in, ok := bind[occasionIn](c)
	if !ok {
		return
	}
	typ := domain.OccurrenceType(in.Type)
	switch typ {
	case domain.Birthday, domain.Otonan, domain.Anniversary:
	default:
		c.JSON(400, gin.H{"error": "invalid occasion type"})
		return
	}
	if _, err := s.st.GetContact(c.Request.Context(), s.scope(c), cid); err != nil {
		respondErr(c, err)
		return
	}
	base, err := domain.ParseDate(in.Date)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	// The client cannot pick a recurrence yet (Task 8): store the type's
	// default so the column is never empty.
	oc, err := s.st.AddOccasion(c.Request.Context(), cid, typ, domain.DefaultRecurrence(typ), base, in.Label)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(201, oc)
}

func (s *Server) handleDeleteOccasion(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := s.st.DeleteOccasion(c.Request.Context(), s.scope(c), id); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

type prefsIn struct {
	Offsets    *[]int    `json:"offsets"`
	ChannelIDs *[]string `json:"channel_ids"`
	Enabled    *bool     `json:"enabled"`
}

var allStreams = []domain.Stream{domain.StreamEvent, domain.StreamYearly, domain.StreamMonthly, domain.StreamOtonan}

// legacyOffsetMap: transitional (Task 8 switches the wire shape to the
// per-stream map) — the flat list the old API sends means "these offsets for
// every reminder", so it is stored under each stream. An empty list is the
// reset signal: an empty map, i.e. inherit the settings defaults.
func legacyOffsetMap(l []int) domain.OffsetMap {
	m := domain.OffsetMap{}
	if len(l) == 0 {
		return m
	}
	for _, s := range allStreams {
		m[s] = append([]int(nil), l...)
	}
	return m
}

// contactOffsets: transitional (per-stream resolution lands in Task 6/8) — the
// store no longer holds a flat contact-level offsets list, so the first
// non-empty per-stream list stands in for the old override. The fixed stream
// order keeps the pick deterministic; ok=false → no contact-level override.
func contactOffsets(m domain.OffsetMap) ([]int, bool) {
	for _, s := range allStreams {
		if len(m[s]) > 0 {
			return m[s], true
		}
	}
	return nil, false
}

func (s *Server) handleSetPrefs(c *gin.Context) {
	cid, ok := pathID(c)
	if !ok {
		return
	}
	in, ok := bind[prefsIn](c)
	if !ok {
		return
	}
	cw, err := s.st.GetContact(c.Request.Context(), s.scope(c), cid)
	if err != nil {
		respondErr(c, err)
		return
	}
	p := store.ReminderPrefs{ContactID: cid, Offsets: domain.OffsetMap{},
		ChannelIDs: []string{}, Enabled: true}
	if cw.Prefs != nil {
		p = *cw.Prefs
		p.ContactID = cid
	}
	if in.Offsets != nil {
		p.Offsets = legacyOffsetMap(*in.Offsets)
	}
	if in.ChannelIDs != nil {
		p.ChannelIDs = *in.ChannelIDs
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if err := domain.ValidateOffsetMap(p.Offsets); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := s.st.SetReminderPrefs(c.Request.Context(), p); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, p)
}

func (s *Server) handlePawukon(c *gin.Context) {
	d, err := domain.ParseDate(c.Query("date"))
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	p := domain.Pawukon(d)
	c.JSON(200, gin.H{"date": d.String(), "saptawara": domain.Saptawara[p.Saptawara],
		"pancawara": domain.Pancawara[p.Pancawara], "wuku": domain.Wuku[p.Wuku], "label": p.Label()})
}

// ---- channels: config is stored encrypted; never sent back ----

type channelIn struct {
	Type   string          `json:"type"`
	Name   string          `json:"name"`
	Config json.RawMessage `json:"config"`
}

func (s *Server) handleListChannels(c *gin.Context) {
	list, err := s.st.ListChannels(c.Request.Context(), s.scope(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, ch := range list {
		out = append(out, gin.H{"id": ch.ID, "type": ch.Type, "name": ch.Name, "enabled": ch.Enabled})
	}
	c.JSON(200, gin.H{"channels": out})
}

func (s *Server) handleCreateChannel(c *gin.Context) {
	in, ok := bind[channelIn](c)
	if !ok {
		return
	}
	enc, err := s.encryptConfig(in.Type, in.Config)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	ch, err := s.st.CreateChannel(c.Request.Context(), mustUser(c).ID, in.Type, in.Name, enc)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(201, gin.H{"id": ch.ID, "type": ch.Type, "name": ch.Name, "enabled": ch.Enabled})
}

func (s *Server) handlePatchChannel(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	in, ok := bind[struct {
		Enabled *bool `json:"enabled"`
	}](c)
	if !ok {
		return
	}
	if in.Enabled == nil {
		c.JSON(400, gin.H{"error": "enabled is required"})
		return
	}
	if err := s.st.SetChannelEnabled(c.Request.Context(), s.scope(c), id, *in.Enabled); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (s *Server) handleDeleteChannel(c *gin.Context) {
	id, ok := pathID(c)
	if !ok {
		return
	}
	if err := s.st.DeleteChannel(c.Request.Context(), s.scope(c), id); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

// validateChannelConfig ensures the JSON config has the minimum fields per type
// before it is encrypted. (The notifier implementation is in Plan 3.)
func (s *Server) validateChannelConfig(typ string, raw json.RawMessage) error {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return errors.New("config must be a JSON object")
	}
	need := map[string][]string{
		"gotify":   {"base_url", "token"},
		"telegram": {"bot_token", "chat_id"},
		"email":    {"host", "port", "from", "to"},
	}[typ]
	if need == nil {
		return errors.New("unknown channel type")
	}
	for _, k := range need {
		if v, ok := m[k]; !ok || v == nil || v == "" {
			return errors.New("config field '" + k + "' is required for type " + typ)
		}
	}
	return nil
}

func (s *Server) encryptConfig(typ string, raw json.RawMessage) ([]byte, error) {
	if err := s.validateChannelConfig(typ, raw); err != nil {
		return nil, err
	}
	return secret.Encrypt(s.key, raw)
}

// ---- settings ----

func (s *Server) handleGetSettings(c *gin.Context) {
	c.JSON(200, s.LoadSettings(c.Request.Context()))
}

func (s *Server) handlePutSettings(c *gin.Context) {
	in, ok := bind[Settings](c)
	if !ok {
		return
	}
	out, err := s.SaveSettings(c.Request.Context(), *in)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

// ---- admin ----

func (s *Server) handleListUsers(c *gin.Context) {
	if mustUser(c).Role != "admin" {
		c.JSON(403, gin.H{"error": "admin only"})
		return
	}
	users, err := s.st.ListUsers(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"users": users})
}

func (s *Server) handleSchedulerRun(c *gin.Context) {
	if mustUser(c).Role != "admin" {
		c.JSON(403, gin.H{"error": "admin only"})
		return
	}
	if s.runner == nil {
		c.JSON(503, gin.H{"error": "scheduler not active"})
		return
	}
	res, err := s.runner.RunOnce(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(200, gin.H{"sent": res.Sent, "failed": res.Failed, "missed": res.Missed})
}
