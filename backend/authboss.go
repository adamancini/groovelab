package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"

	"github.com/aarondl/authboss/v3"
	_ "github.com/aarondl/authboss/v3/auth"
	"github.com/aarondl/authboss/v3/defaults"
	_ "github.com/aarondl/authboss/v3/logout"
	_ "github.com/aarondl/authboss/v3/register"
	"github.com/aarondl/authboss/v3/remember"
	"github.com/adamancini/groovelab/internal/database/queries"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// compile-time interface assertions
var (
	_ authboss.User          = (*ABUser)(nil)
	_ authboss.AuthableUser  = (*ABUser)(nil)
	_ authboss.ArbitraryUser = (*ABUser)(nil)

	_ authboss.ServerStorer            = (*PostgresStorer)(nil)
	_ authboss.CreatingServerStorer    = (*PostgresStorer)(nil)
	_ authboss.RememberingServerStorer = (*PostgresStorer)(nil)
)

// ABUser bridges the queries.User type with the Authboss User interfaces.
type ABUser struct {
	DBUser    *queries.User
	arbitrary map[string]string
}

// GetPID returns the user's primary identifier (email).
func (u *ABUser) GetPID() string {
	if u.DBUser == nil {
		return ""
	}
	return u.DBUser.Email
}

// PutPID sets the user's primary identifier (email).
func (u *ABUser) PutPID(pid string) {
	if u.DBUser == nil {
		u.DBUser = &queries.User{}
	}
	u.DBUser.Email = pid
}

// GetPassword returns the bcrypt hash.
func (u *ABUser) GetPassword() string {
	if u.DBUser == nil || u.DBUser.PasswordHash == nil {
		return ""
	}
	return *u.DBUser.PasswordHash
}

// PutPassword stores the bcrypt hash.
func (u *ABUser) PutPassword(hash string) {
	if u.DBUser == nil {
		u.DBUser = &queries.User{}
	}
	u.DBUser.PasswordHash = &hash
}

// GetArbitrary returns all arbitrary data stored during registration.
func (u *ABUser) GetArbitrary() map[string]string {
	if u.arbitrary == nil {
		return map[string]string{}
	}
	return u.arbitrary
}

// PutArbitrary stores arbitrary data (e.g., name from registration form).
func (u *ABUser) PutArbitrary(arbitrary map[string]string) {
	u.arbitrary = arbitrary
}

// PostgresStorer implements Authboss server storage backed by PostgreSQL.
type PostgresStorer struct {
	q *queries.Querier
}

// NewPostgresStorer creates a storer backed by the given pgxpool.
func NewPostgresStorer(pool *pgxpool.Pool) *PostgresStorer {
	return &PostgresStorer{q: queries.New(pool)}
}

// Load retrieves a user by PID (email).
func (s *PostgresStorer) Load(ctx context.Context, key string) (authboss.User, error) {
	u, err := s.q.GetUserByEmail(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("load user: %w", err)
	}
	if u == nil {
		return nil, authboss.ErrUserNotFound
	}
	return &ABUser{DBUser: u, arbitrary: make(map[string]string)}, nil
}

// Save persists a user to the database.
func (s *PostgresStorer) Save(ctx context.Context, user authboss.User) error {
	abu := user.(*ABUser)
	if abu.DBUser == nil || abu.DBUser.ID == "" {
		return fmt.Errorf("cannot save user without ID")
	}

	ph := ""
	if abu.DBUser.PasswordHash != nil {
		ph = *abu.DBUser.PasswordHash
	}

	oauthProviders := abu.DBUser.OAuthProviders
	if oauthProviders == nil {
		oauthProviders = json.RawMessage("{}")
	}
	instrumentSettings := abu.DBUser.InstrumentSettings
	if instrumentSettings == nil {
		instrumentSettings = json.RawMessage("{}")
	}
	preferences := abu.DBUser.Preferences
	if preferences == nil {
		preferences = json.RawMessage("{}")
	}

	_, err := s.q.UpdateUser(ctx, abu.DBUser.ID, abu.DBUser.Email, ph, abu.DBUser.Role, abu.DBUser.Name,
		oauthProviders, instrumentSettings, preferences)
	if err != nil {
		return fmt.Errorf("save user: %w", err)
	}
	return nil
}

// New creates a blank user for Authboss to populate.
func (s *PostgresStorer) New(_ context.Context) authboss.User {
	return &ABUser{DBUser: &queries.User{}, arbitrary: make(map[string]string)}
}

// Create inserts a new user. The first user in the database gets the admin role.
func (s *PostgresStorer) Create(ctx context.Context, user authboss.User) error {
	abu := user.(*ABUser)

	// Determine role: first user is admin.
	count, err := s.q.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("count users for role assignment: %w", err)
	}
	role := "user"
	if count == 0 {
		role = "admin"
	}

	ph := ""
	if abu.DBUser.PasswordHash != nil {
		ph = *abu.DBUser.PasswordHash
	}

	// Extract optional name from arbitrary registration data.
	var name *string
	if arb := abu.GetArbitrary(); arb != nil {
		if n, ok := arb["name"]; ok && n != "" {
			name = &n
		}
	}

	created, err := s.q.CreateUser(ctx, abu.DBUser.Email, ph, role, name)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	// Update the in-memory user with the created record.
	abu.DBUser = created
	return nil
}

// AddRememberToken stores a remember-me token for the given user.
func (s *PostgresStorer) AddRememberToken(ctx context.Context, pid, token string) error {
	return s.q.AddRememberToken(ctx, pid, token)
}

// DelRememberTokens removes all remember-me tokens for the given user.
func (s *PostgresStorer) DelRememberTokens(ctx context.Context, pid string) error {
	return s.q.DeleteRememberTokens(ctx, pid)
}

// UseRememberToken finds the token, deletes it, and returns nil on success.
// Returns authboss.ErrTokenNotFound if the token does not exist.
func (s *PostgresStorer) UseRememberToken(ctx context.Context, pid, token string) error {
	found, err := s.q.UseRememberToken(ctx, pid, token)
	if err != nil {
		return err
	}
	if !found {
		return authboss.ErrTokenNotFound
	}
	return nil
}

// Auth holds the Authboss instance and related configuration.
type Auth struct {
	AB      *authboss.Authboss
	Storer  *PostgresStorer
	Queries *queries.Querier
}

// Config holds parameters for initializing the auth subsystem.
type Config struct {
	RootURL       string
	MountPath     string
	Pool          *pgxpool.Pool
	RedisClient   *redis.Client
	SessionConfig SessionConfig
	CookieConfig  CookieConfig
}

// Setup initializes Authboss with the auth, register, remember, and logout modules.
// It returns an Auth struct that can be used to mount routes and middleware.
func Setup(cfg Config) (*Auth, error) {
	ab := authboss.New()

	if cfg.RootURL == "" {
		cfg.RootURL = "http://localhost:8080"
	}
	if cfg.MountPath == "" {
		cfg.MountPath = "/api/v1/auth"
	}

	storer := NewPostgresStorer(cfg.Pool)
	sessionStore := NewRedisSessionStorer(cfg.RedisClient, cfg.SessionConfig)
	cookieStore := NewRedisCookieStorer(cfg.RedisClient, cfg.CookieConfig)

	ab.Config.Paths.RootURL = cfg.RootURL
	ab.Config.Paths.Mount = cfg.MountPath
	ab.Config.Paths.AuthLoginOK = "/"
	ab.Config.Paths.RegisterOK = "/"
	ab.Config.Paths.LogoutOK = "/"

	ab.Config.Modules.LogoutMethod = "POST"
	ab.Config.Modules.RegisterPreserveFields = []string{"email"}
	ab.Config.Modules.ResponseOnUnauthed = authboss.RespondUnauthorized

	ab.Config.Storage.Server = storer
	ab.Config.Storage.SessionState = sessionStore
	ab.Config.Storage.CookieState = cookieStore

	// Use JSON renderer for API mode (no HTML templates).
	ab.Config.Core.ViewRenderer = defaults.JSONRenderer{}

	// Set up default core implementations (body reader, hasher, logger, etc.).
	defaults.SetCore(&ab.Config, true, false)

	// Customize body reader validation rules.
	emailRule := defaults.Rules{
		FieldName:  "email",
		Required:   true,
		MatchError: "Must be a valid email address",
		MustMatch:  regexp.MustCompile(`.*@.*\.[a-z]+`),
	}
	passwordRule := defaults.Rules{
		FieldName: "password",
		Required:  true,
		MinLength: 8,
	}
	ab.Config.Core.BodyReader = defaults.HTTPBodyReader{
		ReadJSON: true,
		Rulesets: map[string][]defaults.Rules{
			"register": {emailRule, passwordRule},
		},
		Confirms: map[string][]string{},
		Whitelist: map[string][]string{
			"register": {"email", "password", "name"},
		},
	}

	if err := ab.Init(); err != nil {
		return nil, fmt.Errorf("authboss init: %w", err)
	}

	return &Auth{
		AB:      ab,
		Storer:  storer,
		Queries: queries.New(cfg.Pool),
	}, nil
}

// MountRoutes mounts Authboss routes and the /me endpoint onto the given Chi router.
// The mountPath should match the Authboss config mount (e.g., "/api/v1/auth").
func (a *Auth) MountRoutes(r chi.Router, mountPath string) {
	// Authboss routes: /login, /logout, /register, etc.
	r.Mount(mountPath, http.StripPrefix(mountPath, a.AB.Config.Core.Router))

	// Custom /me endpoint.
	r.Get(mountPath+"/me", a.handleMe)
}

// LoadClientStateMiddleware returns the Authboss middleware that loads
// session and cookie state into the request context.
func (a *Auth) LoadClientStateMiddleware() func(http.Handler) http.Handler {
	return a.AB.LoadClientStateMiddleware
}

// RememberMiddleware returns the remember-me middleware.
func (a *Auth) RememberMiddleware() func(http.Handler) http.Handler {
	return remember.Middleware(a.AB)
}

// handleMe returns the current user's info or 401.
func (a *Auth) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := a.AB.LoadCurrentUser(&r)
	if err != nil || user == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"not authenticated"}`))
		return
	}

	abu, ok := user.(*ABUser)
	if !ok || abu.DBUser == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal error"}`))
		return
	}

	resp := struct {
		ID      string  `json:"id"`
		Email   string  `json:"email"`
		Name    *string `json:"name"`
		Role    string  `json:"role"`
		IsAdmin bool    `json:"isAdmin"`
	}{
		ID:      abu.DBUser.ID,
		Email:   abu.DBUser.Email,
		Name:    abu.DBUser.Name,
		Role:    abu.DBUser.Role,
		IsAdmin: abu.DBUser.Role == "admin",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("error encoding /me response: %v", err)
	}
}
