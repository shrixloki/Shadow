package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"
)

type SyncWorker struct {
	sessionStore *SessionStore
	syncQueue    chan SyncJob
	workers      int
	wg           sync.WaitGroup
	shutdown     chan bool
}

type SyncJob struct {
	SessionID string
	Operation string
	Payload   map[string]interface{}
	Timestamp time.Time
}

type SyncResult struct {
	Success   bool   `json:"success"`
	SessionID string `json:"session_id"`
	Error     string `json:"error,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

func NewSyncWorker(sessionStore *SessionStore, workers int) *SyncWorker {
	return &SyncWorker{
		sessionStore: sessionStore,
		syncQueue:    make(chan SyncJob, 100),
		workers:      workers,
		shutdown:     make(chan bool),
	}
}

func (sw *SyncWorker) Start() {
	log.Printf("Starting %d sync workers", sw.workers)
	
	for i := 0; i < sw.workers; i++ {
		sw.wg.Add(1)
		go sw.worker(i)
	}
}

func (sw *SyncWorker) Stop() {
	log.Println("Stopping sync workers")
	close(sw.shutdown)
	sw.wg.Wait()
	close(sw.syncQueue)
}

func (sw *SyncWorker) QueueSync(sessionID string, operation string, payload map[string]interface{}) {
	job := SyncJob{
		SessionID: sessionID,
		Operation: operation,
		Payload:   payload,
		Timestamp: time.Now(),
	}
	
	select {
	case sw.syncQueue <- job:
		// Job queued successfully
	default:
		log.Printf("Sync queue full, dropping job for session %s", sessionID)
	}
}

func (sw *SyncWorker) worker(id int) {
	defer sw.wg.Done()
	
	log.Printf("Sync worker %d started", id)
	
	for {
		select {
		case job := <-sw.syncQueue:
			result := sw.processJob(job)
			if !result.Success {
				log.Printf("Worker %d: Sync failed for session %s: %s", id, job.SessionID, result.Error)
			}
			
		case <-sw.shutdown:
			log.Printf("Sync worker %d shutting down", id)
			return
		}
	}
}

func (sw *SyncWorker) processJob(job SyncJob) SyncResult {
	result := SyncResult{
		SessionID: job.SessionID,
		Timestamp: time.Now(),
	}
	
	switch job.Operation {
	case "delta_sync":
		err := sw.processDeltaSync(job)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Success = true
		}
		
	case "snapshot_sync":
		err := sw.processSnapshotSync(job)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Success = true
		}
		
	case "status_update":
		err := sw.processStatusUpdate(job)
		if err != nil {
			result.Error = err.Error()
		} else {
			result.Success = true
		}
		
	default:
		result.Error = fmt.Sprintf("unknown operation: %s", job.Operation)
	}
	
	return result
}

func (sw *SyncWorker) processDeltaSync(job SyncJob) error {
	// Extract delta from payload
	delta, ok := job.Payload["delta"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid delta payload")
	}
	
	// Apply delta to session
	return sw.sessionStore.SyncSession(job.SessionID, delta, nil)
}

func (sw *SyncWorker) processSnapshotSync(job SyncJob) error {
	// Extract snapshot from payload
	snapshot, ok := job.Payload["snapshot"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid snapshot payload")
	}
	
	// Replace session state with snapshot
	return sw.sessionStore.SyncSession(job.SessionID, nil, snapshot)
}

func (sw *SyncWorker) processStatusUpdate(job SyncJob) error {
	// Extract status from payload
	status, ok := job.Payload["status"].(string)
	if !ok {
		return fmt.Errorf("invalid status payload")
	}
	
	// Update session status
	return sw.sessionStore.UpdateSessionStatus(job.SessionID, status)
}

func (sw *SyncWorker) GetQueueStats() map[string]interface{} {
	return map[string]interface{}{
		"queue_length": len(sw.syncQueue),
		"workers":      sw.workers,
		"timestamp":    time.Now(),
	}
}

// Atomic write operations with versioning
func (sw *SyncWorker) AtomicSync(sessionID string, expectedVersion int, updates map[string]interface{}) error {
	session, err := sw.sessionStore.GetSession(sessionID)
	if err != nil {
		return err
	}
	
	if session.Version != expectedVersion {
		return fmt.Errorf("version conflict: expected %d, got %d", expectedVersion, session.Version)
	}
	
	// Apply updates atomically
	return sw.sessionStore.SyncSession(sessionID, updates, nil)
}

// Batch sync operations
func (sw *SyncWorker) BatchSync(jobs []SyncJob) []SyncResult {
	results := make([]SyncResult, len(jobs))
	
	for i, job := range jobs {
		results[i] = sw.processJob(job)
	}
	
	return results
}