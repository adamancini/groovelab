package main

import (
	"context"
	"time"

	"github.com/adamancini/groovelab/internal/database"
	"github.com/adamancini/groovelab/internal/migrate"
)

// runMigrations connects to the database and runs all pending goose migrations
// from the migrations directory. It is invoked via the "migrate" subcommand.
func runMigrations(migrationsDir string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dsn := database.ResolveDSN()
	return migrate.Run(ctx, dsn, migrationsDir)
}
