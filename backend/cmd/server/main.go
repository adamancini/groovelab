package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/adamancini/groovelab/internal/cache"
	"github.com/adamancini/groovelab/internal/health"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	// Handle "migrate" subcommand.
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		migrationsDir := "migrations"
		if len(os.Args) > 2 {
			migrationsDir = os.Args[2]
		}
		if err := runMigrations(migrationsDir); err != nil {
			log.Fatalf("migration failed: %v", err)
		}
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Connect to PostgreSQL.
	dbPool, err := connectDatabase(ctx)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer dbPool.Close()
	log.Println("connected to PostgreSQL")

	// Connect to Redis.
	redisClient, err := cache.NewClient(ctx)
	if err != nil {
		log.Fatalf("redis connection failed: %v", err)
	}
	defer func() {
		if err := redisClient.Close(); err != nil {
			log.Printf("error closing redis: %v", err)
		}
	}()
	log.Println("connected to Redis")

	// Build router.
	version := os.Getenv("APP_VERSION")
	if version == "" {
		version = "0.1.0"
	}

	healthHandler := health.NewHandler(dbPool, redisClient, version)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	// Health probes (not versioned).
	r.Get("/healthz", healthHandler.Readiness)
	r.Get("/livez", healthHandler.Liveness)

	// Versioned API route group.
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"Groovelab API v1"}`))
		})
	})

	// Start server.
	addr := ":8080"
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Run server in a goroutine.
	go func() {
		log.Printf("starting server on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Wait for shutdown signal.
	<-ctx.Done()
	log.Println("shutting down server...")

	// Graceful shutdown with 15-second drain timeout.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server shutdown error: %v", err)
	}
	log.Println("server stopped gracefully")
}
