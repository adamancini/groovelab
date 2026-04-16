package main

import (
	"context"
	"log"
	"time"

	"github.com/adamancini/groovelab/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// connectDatabase establishes a connection to PostgreSQL with retry logic
// suitable for container startup where the database may not be ready yet.
func connectDatabase(ctx context.Context) (*pgxpool.Pool, error) {
	var pool *pgxpool.Pool
	var err error

	maxRetries := 5
	for i := 0; i < maxRetries; i++ {
		pool, err = database.NewPool(ctx)
		if err == nil {
			return pool, nil
		}
		log.Printf("database connection attempt %d/%d failed: %v", i+1, maxRetries, err)

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(i+1) * time.Second):
			// Exponential-ish backoff.
		}
	}
	return nil, err
}
