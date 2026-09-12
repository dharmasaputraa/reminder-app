package domain

// JDN returns the integer Julian Day Number for the civil Gregorian date,
// using the Fliegel–Van Flandern algorithm. Go's truncating integer division
// is exactly what this formula expects (a = -1 for Jan/Feb).
func (d Date) JDN() int {
	i, j, k := d.Year, d.Month, d.Day
	a := (j - 14) / 12
	return k - 32075 + 1461*(i+4800+a)/4 + 367*(j-2-a*12)/12 - 3*((i+4900+a)/100)/4
}

// DateFromJDN converts a Julian Day Number back to a civil Gregorian date
// (Richards' inverse; all divisions are on positive operands).
func DateFromJDN(jdn int) Date {
	a := jdn + 32044
	b := (4*a + 3) / 146097
	c := a - 146097*b/4
	dd := (4*c + 3) / 1461
	e := c - 1461*dd/4
	m := (5*e + 2) / 153
	day := e - (153*m+2)/5 + 1
	month := m + 3 - 12*(m/10)
	year := 100*b + dd - 4800 + m/10
	return Date{Year: year, Month: month, Day: day}
}

// Weekday returns 0=Sunday (Redite) … 6=Saturday (Saniscara).
func (d Date) Weekday() int { return (d.JDN() + 1) % 7 }
