// Package cache provides Redis client initialization via go-redis.
package cache

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

// Config holds Redis connection parameters.
type Config struct {
	Addr        string
	Password    string
	DB          int
	ConnTimeout time.Duration
}

// ConfigFromEnv reads Redis configuration from environment variables.
// REDIS_URL takes precedence; otherwise REDIS_HOST and REDIS_PORT are used.
func ConfigFromEnv() Config {
	cfg := Config{
		Addr:        "localhost:6379",
		Password:    "",
		DB:          0,
		ConnTimeout: 5 * time.Second,
	}

	host := "localhost"
	port := "6379"

	if v := os.Getenv("REDIS_HOST"); v != "" {
		host = v
	}
	if v := os.Getenv("REDIS_PORT"); v != "" {
		port = v
	}
	cfg.Addr = host + ":" + port

	if v := os.Getenv("REDIS_PASSWORD"); v != "" {
		cfg.Password = v
	}

	return cfg
}

// NewClient creates a new Redis client from environment configuration.
// If REDIS_URL is set, it is parsed directly; otherwise individual env vars are used.
func NewClient(ctx context.Context) (*redis.Client, error) {
	var opts *redis.Options

	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		var err error
		opts, err = redis.ParseURL(redisURL)
		if err != nil {
			return nil, fmt.Errorf("parse REDIS_URL: %w", err)
		}
	} else {
		cfg := ConfigFromEnv()
		opts = &redis.Options{
			Addr:     cfg.Addr,
			Password: cfg.Password,
			DB:       cfg.DB,
		}
	}

	client := redis.NewClient(opts)

	cfg := ConfigFromEnv()
	pingCtx, cancel := context.WithTimeout(ctx, cfg.ConnTimeout)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return client, nil
}

// Ping checks the Redis connection health and returns the round-trip latency.
func Ping(ctx context.Context, client *redis.Client) (time.Duration, error) {
	start := time.Now()
	err := client.Ping(ctx).Err()
	return time.Since(start), err
}
