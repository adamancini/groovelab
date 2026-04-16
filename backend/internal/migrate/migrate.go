// Package migrate provides goose migration runner functionality.
package migrate

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"github.com/adamancini/groovelab/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Run connects to the database and runs all pending goose migrations from
// the given directory. It resolves the DSN from DATABASE_URL or individual
// DATABASE_* environment variables.
func Run(ctx context.Context, dsn, migrationsDir string) error {
	db, err := OpenDB(dsn)
	if err != nil {
		return err
	}
	defer func() {
		if err := db.Close(); err != nil {
			log.Printf("error closing db: %v", err)
		}
	}()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping database before migration: %w", err)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}

	if err := goose.UpContext(ctx, db, migrationsDir); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	log.Println("migrations applied successfully")
	return nil
}

// OpenDB creates a *sql.DB backed by pgx stdlib from a PostgreSQL DSN.
func OpenDB(dsn string) (*sql.DB, error) {
	connConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	return stdlib.OpenDB(*connConfig), nil
}

// ResolveDSN returns DATABASE_URL if set, otherwise builds a DSN from
// individual environment variables.
func ResolveDSN() string {
	return database.ResolveDSN()
}
