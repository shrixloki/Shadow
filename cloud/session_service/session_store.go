package main

import (
	"fmt"
	"sync"
	"time"
	"crypto/rand"
	"encoding/hex"
)

type Session struct {
	ID            string                 `json:"id"`
	WorkspacePath string                 `json:"workspace_path"`
	Metadata      map[string]string      `json:"metadata"`
	State         map[string]interface{} `json:"state"`
	Status        string                 `json:"status"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	ExpiresAt     time.Time              `json:"expires_at"`
	Version       int                    `json:"version"`
}

type SessionStore struct {
	sessions map[string]*Session
	mutex    sync.RWMutex
	ttl      time.Duration
}

func NewSessionStore() *SessionStore {
	store := &SessionStore{
		sessions: make(map[string]*Session),
		ttl:      72 * time.Hour, // Default TTL
	}
	
	// Start cleanup goroutine
	go store.cleanupExpiredSessions()
	
	return store
}

func (s *SessionStore) CreateSession(workspacePath string, metadata map[string]string) (*Session, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	sessionID, err := generateSessionID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %v", err)
	}

	now := time.Now()
	session := &Session{
		ID:            sessionID,
		WorkspacePath: workspacePath,
		Metadata:      metadata,
		State:         make(map[string]interface{}),
		Status:        "created",
		CreatedAt:     now,
		UpdatedAt:     now,
		ExpiresAt:     now.Add(s.ttl),
		Version:       1,
	}

	s.sessions[sessionID] = session
	return session, nil
}

func (s *SessionStore) GetSession(sessionID string) (*Session, error) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, fmt.Errorf("session expired: %s", sessionID)
	}

	return session, nil
}

func (s *SessionStore) SyncSession(sessionID string, delta map[string]interface{}, snapshot map[string]interface{}) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if time.Now().After(session.ExpiresAt) {
		return fmt.Errorf("session expired: %s", sessionID)
	}

	// Apply delta or replace with snapshot
	if snapshot != nil {
		session.State = snapshot
	} else if delta != nil {
		// Simple merge for delta (in production, use proper CRDT)
		for key, value := range delta {
			session.State[key] = value
		}
	}

	session.UpdatedAt = time.Now()
	session.Version++
	session.Status = "synced"

	return nil
}

func (s *SessionStore) UpdateSessionStatus(sessionID string, status string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.Status = status
	session.UpdatedAt = time.Now()
	session.Version++

	return nil
}

func (s *SessionStore) ListSessions() []*Session {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	var sessions []*Session
	now := time.Now()

	for _, session := range s.sessions {
		if now.Before(session.ExpiresAt) {
			sessions = append(sessions, session)
		}
	}

	return sessions
}

func (s *SessionStore) DeleteSession(sessionID string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	delete(s.sessions, sessionID)
	return nil
}

func (s *SessionStore) cleanupExpiredSessions() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.mutex.Lock()
			now := time.Now()
			
			for sessionID, session := range s.sessions {
				if now.After(session.ExpiresAt) {
					delete(s.sessions, sessionID)
				}
			}
			
			s.mutex.Unlock()
		}
	}
}

func generateSessionID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}