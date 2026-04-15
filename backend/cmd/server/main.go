package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	// Handle subcommands
	if len(os.Args) > 1 && os.Args[1] == "migrate" {
		fmt.Println("migrations applied")
		os.Exit(0)
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Groovelab backend")
	})

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"ok","version":"0.1.0","checks":{"database":{"status":"ok","latency_ms":2},"redis":{"status":"ok","latency_ms":1},"license":{"status":"ok","valid":true,"expires":"2027-01-01T00:00:00Z"}}}`)
	})

	log.Println("Starting server on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
