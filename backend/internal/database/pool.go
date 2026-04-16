// Package database provides PostgreSQL connection pooling via pgx.
package database

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Config holds PostgreSQL connection parameters.
type Config struct {
	Host        string
	Port        int
	User        string
	Password    string
	Database    string
	SSLMode     string
	MaxConns    int32
	ConnTimeout time.Duration
}

// ConfigFromEnv reads PostgreSQL configuration from environment variables.
// It checks DATABASE_URL first; if absent, it falls back to individual
// DATABASE_* variables. For Helm compatibility, DB_HOST and DB_PORT are
// also accepted as fallbacks.
func ConfigFromEnv() Config {
	cfg := Config{
		Host:        "localhost",
		Port:        5432,
		User:        "groovelab",
		Password:    "",
		Database:    "groovelab",
		SSLMode:     "disable",
		MaxConns:    10,
		ConnTimeout: 5 * time.Second,
	}

	if v := os.Getenv("DATABASE_HOST"); v != "" {
		cfg.Host = v
	} else if v := os.Getenv("DB_HOST"); v != "" {
		cfg.Host = v
	}

	if v := os.Getenv("DATABASE_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Port = p
		}
	} else if v := os.Getenv("DB_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Port = p
		}
	}

	if v := os.Getenv("DATABASE_USER"); v != "" {
		cfg.User = v
	}
	if v := os.Getenv("DATABASE_PASSWORD"); v != "" {
		cfg.Password = v
	}
	if v := os.Getenv("DATABASE_NAME"); v != "" {
		cfg.Database = v
	}
	if v := os.Getenv("DATABASE_SSLMODE"); v != "" {
		cfg.SSLMode = v
	}
	if v := os.Getenv("DATABASE_MAX_CONNS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil {
			cfg.MaxConns = int32(n)
		}
	}

	return cfg
}

// DSN returns a PostgreSQL connection string from the config.
func (c Config) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.User, c.Password, c.Host, c.Port, c.Database, c.SSLMode,
	)
}

// NewPool creates a new pgxpool.Pool from environment configuration.
// If DATABASE_URL is set, it takes precedence over individual config fields.
func NewPool(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = ConfigFromEnv().DSN()
	}

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}

	cfg := ConfigFromEnv()
	poolCfg.MaxConns = cfg.MaxConns

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	// Verify connectivity.
	pingCtx, cancel := context.WithTimeout(ctx, cfg.ConnTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// Ping checks the database connection health and returns the round-trip latency.
func Ping(ctx context.Context, pool *pgxpool.Pool) (time.Duration, error) {
	start := time.Now()
	err := pool.Ping(ctx)
	return time.Since(start), err
}

// ResolveDSN returns DATABASE_URL if set, otherwise builds a DSN from
// individual environment variables.
func ResolveDSN() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	return ConfigFromEnv().DSN()
}
