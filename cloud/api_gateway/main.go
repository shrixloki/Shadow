package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

type Config struct {
	API struct {
		Host string `json:"host"`
		Port int    `json:"port"`
		TLS  struct {
			Enabled  bool   `json:"enabled"`
			CertPath string `json:"cert_path"`
			KeyPath  string `json:"key_path"`
		} `json:"tls"`
	} `json:"api"`
	Auth struct {
		TokenHeader string `json:"token_header"`
		TokenLength int    `json:"token_length"`
	} `json:"auth"`
	Session struct {
		TTLHours     int    `json:"ttl_hours"`
		MaxPayloadMB int    `json:"max_payload_mb"`
		Storage      string `json:"storage"`
	} `json:"session"`
}

type APIGateway struct {
	config        *Config
	sessionStore  *SessionStore
	dockerRunner  *DockerRunner
	upgrader      websocket.Upgrader
}

type SessionInitRequest struct {
	WorkspacePath string            `json:"workspace_path"`
	Metadata      map[string]string `json:"metadata"`
}

type SessionSyncRequest struct {
	SessionID string                 `json:"session_id"`
	Delta     map[string]interface{} `json:"delta"`
	Snapshot  map[string]interface{} `json:"snapshot"`
}

type SessionExecuteRequest struct {
	SessionID   string   `json:"session_id"`
	Command     string   `json:"command"`
	Environment []string `json:"environment"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func NewAPIGateway() (*APIGateway, error) {
	config, err := loadConfig()
	if err != nil {
		return nil, err
	}

	sessionStore := NewSessionStore()
	dockerRunner := NewDockerRunner()

	return &APIGateway{
		config:       config,
		sessionStore: sessionStore,
		dockerRunner: dockerRunner,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
	}, nil
}

func (gw *APIGateway) Start() error {
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api/v1").Subrouter()
	api.Use(gw.authMiddleware)
	
	api.HandleFunc("/session/init", gw.handleSessionInit).Methods("POST")
	api.HandleFunc("/session/sync", gw.handleSessionSync).Methods("POST")
	api.HandleFunc("/session/execute", gw.handleSessionExecute).Methods("POST")
	api.HandleFunc("/session/list", gw.handleSessionList).Methods("GET")
	api.HandleFunc("/session/{id}", gw.handleSessionGet).Methods("GET")

	// WebSocket for log streaming
	r.HandleFunc("/ws/logs/{session_id}", gw.handleLogStream)

	// CORS middleware
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Shadow-Token")
			
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			
			next.ServeHTTP(w, r)
		})
	})

	addr := fmt.Sprintf("%s:%d", gw.config.API.Host, gw.config.API.Port)
	log.Printf("Starting API Gateway on %s", addr)
	
	return http.ListenAndServe(addr, r)
}

func (gw *APIGateway) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get(gw.config.Auth.TokenHeader)
		if token == "" {
			gw.sendError(w, "Missing auth token", http.StatusUnauthorized)
			return
		}
		
		// Simple token validation (in production, use proper JWT or similar)
		if len(token) < gw.config.Auth.TokenLength {
			gw.sendError(w, "Invalid auth token", http.StatusUnauthorized)
			return
		}
		
		next.ServeHTTP(w, r)
	})
}

func (gw *APIGateway) handleSessionInit(w http.ResponseWriter, r *http.Request) {
	var req SessionInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		gw.sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	session, err := gw.sessionStore.CreateSession(req.WorkspacePath, req.Metadata)
	if err != nil {
		gw.sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	gw.sendSuccess(w, map[string]interface{}{
		"session_id": session.ID,
		"created_at": session.CreatedAt,
		"expires_at": session.ExpiresAt,
	})
}

func (gw *APIGateway) handleSessionSync(w http.ResponseWriter, r *http.Request) {
	var req SessionSyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		gw.sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	err := gw.sessionStore.SyncSession(req.SessionID, req.Delta, req.Snapshot)
	if err != nil {
		gw.sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	gw.sendSuccess(w, map[string]string{
		"status": "synced",
		"session_id": req.SessionID,
	})
}

func (gw *APIGateway) handleSessionExecute(w http.ResponseWriter, r *http.Request) {
	var req SessionExecuteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		gw.sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	session, err := gw.sessionStore.GetSession(req.SessionID)
	if err != nil {
		gw.sendError(w, "Session not found", http.StatusNotFound)
		return
	}

	// Start execution in background
	go func() {
		err := gw.dockerRunner.ExecuteSession(session, req.Command, req.Environment)
		if err != nil {
			log.Printf("Execution error for session %s: %v", req.SessionID, err)
		}
	}()

	gw.sendSuccess(w, map[string]string{
		"status": "executing",
		"session_id": req.SessionID,
	})
}

func (gw *APIGateway) handleSessionList(w http.ResponseWriter, r *http.Request) {
	sessions := gw.sessionStore.ListSessions()
	gw.sendSuccess(w, map[string]interface{}{
		"sessions": sessions,
	})
}

func (gw *APIGateway) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	session, err := gw.sessionStore.GetSession(sessionID)
	if err != nil {
		gw.sendError(w, "Session not found", http.StatusNotFound)
		return
	}

	gw.sendSuccess(w, session)
}

func (gw *APIGateway) handleLogStream(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["session_id"]

	conn, err := gw.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Subscribe to logs for this session
	logChan := gw.dockerRunner.SubscribeToLogs(sessionID)
	defer gw.dockerRunner.UnsubscribeFromLogs(sessionID, logChan)

	for {
		select {
		case logEntry, ok := <-logChan:
			if !ok {
				return
			}
			
			if err := conn.WriteJSON(logEntry); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		case <-time.After(30 * time.Second):
			// Send ping to keep connection alive
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (gw *APIGateway) sendSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(APIResponse{
		Success: true,
		Data:    data,
	})
}

func (gw *APIGateway) sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(APIResponse{
		Success: false,
		Error:   message,
	})
}

func loadConfig() (*Config, error) {
	configPath := filepath.Join("cloud", "config", "cloud.config.json")
	
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config: %v", err)
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %v", err)
	}

	return &config, nil
}

func main() {
	gateway, err := NewAPIGateway()
	if err != nil {
		log.Fatalf("Failed to create API gateway: %v", err)
	}

	if err := gateway.Start(); err != nil {
		log.Fatalf("Failed to start API gateway: %v", err)
	}
}