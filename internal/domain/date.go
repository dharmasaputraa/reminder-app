package domain

import (
	"fmt"
	"time"
)

// Date is a civil Gregorian calendar date — no timezone, no clock component.
// The domain engine works exclusively on this type; timezones are applied at
// the scheduler layer (Plan 3).
type Date struct {
	Year  int
	Month int
	Day   int
}

func NewDate(year, month, day int) Date { return Date{Year: year, Month: month, Day: day} }

func DateFromTime(t time.Time) Date { return Date{Year: t.Year(), Month: int(t.Month()), Day: t.Day()} }

func (d Date) Time(loc *time.Location) time.Time {
	return time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, loc)
}

func (d Date) AddDays(n int) Date { return DateFromJDN(d.JDN() + n) }

func (d Date) Before(o Date) bool { return d.JDN() < o.JDN() }
func (d Date) After(o Date) bool  { return d.JDN() > o.JDN() }
func (d Date) Equal(o Date) bool  { return d == o }

func (d Date) String() string { return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day) }
