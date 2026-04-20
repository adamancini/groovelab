package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/adamancini/groovelab/internal/admin"
	grooveauth "github.com/adamancini/groovelab/internal/auth"
	"github.com/adamancini/groovelab/internal/cache"
	"github.com/adamancini/groovelab/internal/flashcards"
	"github.com/adamancini/groovelab/internal/fretboard"
	"github.com/adamancini/groovelab/internal/health"
	"github.com/adamancini/groovelab/internal/progress"
	"github.com/adamancini/groovelab/internal/replicated"
	"github.com/adamancini/groovelab/internal/settings"
	"github.com/adamancini/groovelab/internal/tracks"
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

	// Set up authentication.
	rootURL := os.Getenv("ROOT_URL")
	if rootURL == "" {
		rootURL = "http://localhost:8080"
	}

	authSystem, err := grooveauth.Setup(grooveauth.Config{
		RootURL:       rootURL,
		MountPath:     "/api/v1/auth",
		Pool:          dbPool,
		RedisClient:   redisClient,
		SessionConfig: grooveauth.DefaultSessionConfig(),
		CookieConfig:  grooveauth.DefaultCookieConfig(),
	})
	if err != nil {
		log.Fatalf("auth setup failed: %v", err)
	}
	log.Println("authentication initialized")

	// Start Replicated SDK polling client.
	sdkClient := replicated.NewSDKClient(redisClient, dbPool)
	sdkClient.Start(ctx)
	defer sdkClient.Stop()
	log.Println("replicated SDK polling started")

	// Build router.
	version := os.Getenv("APP_VERSION")
	if version == "" {
		version = "0.1.0"
	}

	healthHandler := health.NewHandler(dbPool, redisClient, version)
	replicatedHandler := replicated.NewHandler(redisClient)
	fretboardHandler := fretboard.NewHandler(dbPool)
	settingsHandler := settings.NewHandler(dbPool, authSystem.AB)
	trackHandler := tracks.NewHandler(dbPool, authSystem.AB)
	progressHandler := progress.NewHandler(dbPool, authSystem.AB)
	adminHandler := admin.NewHandler(dbPool, authSystem.AB)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(authSystem.LoadClientStateMiddleware())
	r.Use(authSystem.RememberMiddleware())

	// License enforcement middleware: blocks expired licenses for authenticated routes.
	// Exempt: /healthz, /livez, /api/v1/auth/*, /api/replicated/*
	r.Use(replicated.RequireLicenseValid(redisClient))

	// Health probes (not versioned).
	r.Get("/healthz", healthHandler.Readiness)
	r.Get("/livez", healthHandler.Liveness)

	// Replicated SDK proxy routes (no auth required -- frontend fetches these).
	r.Route("/api/replicated", func(r chi.Router) {
		replicatedHandler.MountRoutes(r)
	})

	// Versioned API route group.
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"Groovelab API v1"}`))
		})

		// Track CRUD (authenticated users only).
		r.Route("/tracks", func(r chi.Router) {
			r.Use(grooveauth.RequireAuth(authSystem.AB))
			trackHandler.MountRoutes(r)

			// Track export: auth + entitlement dual-gate.
			r.Route("/{id}/export", func(r chi.Router) {
				r.Use(replicated.RequireEntitlement(redisClient, "track_export_enabled"))
				r.Get("/", trackHandler.Export)
			})
		})

		// Progress and streak tracking (authenticated users only).
		r.Route("/progress", func(r chi.Router) {
			r.Use(grooveauth.RequireAuth(authSystem.AB))
			progressHandler.MountRoutes(r)
		})
	})

	// Auth routes: /api/v1/auth/{login,logout,register,me}
	authSystem.MountRoutes(r, "/api/v1/auth")

	// Fretboard reference data (public).
	r.Route("/api/v1/fretboard", func(r chi.Router) {
		r.Get("/tunings", fretboardHandler.ListTunings)
	})

	// User settings (requires auth).
	r.Route("/api/v1/settings", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Get("/", settingsHandler.GetSettings)
		r.Put("/", settingsHandler.UpdateSettings)
	})

	// Admin routes (require auth + admin role).
	r.Route("/api/v1/admin", func(r chi.Router) {
		r.Use(grooveauth.RequireAuth(authSystem.AB))
		r.Use(grooveauth.RequireAdmin(authSystem.AB))
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"message":"admin area"}`))
		})

		// Admin endpoints: user management + track moderation.
		adminHandler.MountRoutes(r)
	})

	// Flashcard routes (auth optional -- guests can play without persistence).
	// ConditionalAuth gates these routes only when GUEST_ACCESS_ENABLED=false.
	flashcardStore := flashcards.NewStore(dbPool)
	flashcardHandler := flashcards.NewHandler(flashcardStore, authSystem.AB)
	r.Group(func(r chi.Router) {
		r.Use(grooveauth.ConditionalAuth(authSystem.AB))
		flashcardHandler.MountRoutes(r, "/api/v1/flashcards")
	})
	log.Println("flashcard routes mounted")

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
