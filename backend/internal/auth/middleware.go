package auth

import (
	"net/http"
	"os"

	"github.com/aarondl/authboss/v3"
)

// guestAccessEnabled reports whether guest (unauthenticated) access is allowed
// for non-admin learning routes. Reads GUEST_ACCESS_ENABLED, defaults to true.
// Mapped from KOTS Config item "guest_access" via release/helmchart.yaml.
// See GRO-7uiw.
func guestAccessEnabled() bool {
	v := os.Getenv("GUEST_ACCESS_ENABLED")
	if v == "" {
		return true
	}
	return v == "true" || v == "1"
}

// ConditionalAuth returns RequireAuth when guest access is disabled, and a
// passthrough middleware otherwise. Used to gate flashcard learning routes:
// when GUEST_ACCESS_ENABLED=false, all flashcard requests must be
// authenticated; when true (default), guests can play without persistence.
func ConditionalAuth(ab *authboss.Authboss) func(http.Handler) http.Handler {
	if guestAccessEnabled() {
		return func(next http.Handler) http.Handler { return next }
	}
	return RequireAuth(ab)
}

// RequireAuth is a Chi middleware that returns 401 for unauthenticated requests.
// It checks whether Authboss has loaded a current user into the request context.
func RequireAuth(ab *authboss.Authboss) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := ab.LoadCurrentUser(&r)
			if err != nil || user == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"authentication required"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin is a Chi middleware that returns 403 for non-admin users.
// It must be placed after RequireAuth in the middleware chain.
func RequireAdmin(ab *authboss.Authboss) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := ab.LoadCurrentUser(&r)
			if err != nil || user == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"authentication required"}`))
				return
			}

			abu, ok := user.(*ABUser)
			if !ok || abu.DBUser == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"internal error"}`))
				return
			}

			if abu.DBUser.Role != "admin" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"admin access required"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
