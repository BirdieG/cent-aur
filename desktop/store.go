package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Store is the offline data: one SQLite file holding the page's data as one JSON document with a
// revision number, exactly as api.php keeps each user's data on the server.
type Store struct{ db *sql.DB }

// Clash means the data was saved in between (another Cent-aur window): Rev is the current revision.
type Clash struct{ Rev int }

func (c *Clash) Error() string { return fmt.Sprintf("saved in between (revision %d)", c.Rev) }

func OpenStore(file string) (*Store, error) {
	db, err := sql.Open("sqlite", file+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS doc(
		id INTEGER PRIMARY KEY CHECK (id = 1),
		data TEXT NOT NULL,
		rev INTEGER NOT NULL,
		updated INTEGER NOT NULL)`); err != nil {
		db.Close()
		return nil, fmt.Errorf("opening %s: %w", file, err)
	}
	return &Store{db}, nil
}

// Get returns the revision and the data (nil when nothing was saved yet).
func (s *Store) Get() (int, json.RawMessage, error) {
	var data string
	var rev int
	err := s.db.QueryRow(`SELECT data, rev FROM doc WHERE id = 1`).Scan(&data, &rev)
	if err == sql.ErrNoRows {
		return 0, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	return rev, json.RawMessage(data), nil
}

// Put saves data on top of revision rev and returns the new revision, or a *Clash.
func (s *Store) Put(rev int, data json.RawMessage) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	cur := 0
	if err := tx.QueryRow(`SELECT rev FROM doc WHERE id = 1`).Scan(&cur); err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if cur != rev {
		return 0, &Clash{cur}
	}
	if _, err := tx.Exec(`INSERT OR REPLACE INTO doc(id, data, rev, updated) VALUES(1, ?, ?, ?)`,
		string(data), cur+1, time.Now().UnixMilli()); err != nil {
		return 0, err
	}
	return cur + 1, tx.Commit()
}
