package store

import (
	"context"
	"strings"
)

type User struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

// GetOrCreateUser: auto-provision dari klaim email. Role hanya diset saat create.
func (s *Store) GetOrCreateUser(ctx context.Context, email, name string, adminEmails map[string]bool) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	role := "member"
	if adminEmails[email] {
		role = "admin"
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO users (email, name, role) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING`,
		email, name, role); err != nil {
		return User{}, err
	}
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, name, role FROM users WHERE email = ?`, email).
		Scan(&u.ID, &u.Email, &u.Name, &u.Role)
	return u, err
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, email, name, role FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
