package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/client"
)

type DockerRunner struct {
	client       *client.Client
	baseImage    string
	timeout      time.Duration
	maxConcurrent int
	running      map[string]*RunningContainer
	mutex        sync.RWMutex
	logStreams   map[string][]chan LogEntry
	logMutex     sync.RWMutex
}

type RunningContainer struct {
	ID        string
	SessionID string
	StartTime time.Time
	Status    string
}

type LogEntry struct {
	SessionID string    `json:"session_id"`
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	Source    string    `json:"source"`
}

type ExecutionResult struct {
	SessionID  string    `json:"session_id"`
	ExitCode   int       `json:"exit_code"`
	Output     string    `json:"output"`
	Error      string    `json:"error,omitempty"`
	StartTime  time.Time `json:"start_time"`
	EndTime    time.Time `json:"end_time"`
	Duration   string    `json:"duration"`
}

func NewDockerRunner() *DockerRunner {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("Failed to create Docker client: %v", err)
	}

	return &DockerRunner{
		client:        cli,
		baseImage:     "node:18-alpine",
		timeout:       5 * time.Minute,
		maxConcurrent: 5,
		running:       make(map[string]*RunningContainer),
		logStreams:    make(map[string][]chan LogEntry),
	}
}

func (dr *DockerRunner) ExecuteSession(session *Session, command string, environment []string) error {
	dr.mutex.Lock()
	if len(dr.running) >= dr.maxConcurrent {
		dr.mutex.Unlock()
		return fmt.Errorf("maximum concurrent executions reached")
	}
	dr.mutex.Unlock()

	// Create temporary directory for session files
	tempDir, err := dr.prepareSessionFiles(session)
	if err != nil {
		return fmt.Errorf("failed to prepare session files: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create and start container
	containerID, err := dr.createContainer(session.ID, tempDir, command, environment)
	if err != nil {
		return fmt.Errorf("failed to create container: %v", err)
	}

	// Track running container
	dr.mutex.Lock()
	dr.running[session.ID] = &RunningContainer{
		ID:        containerID,
		SessionID: session.ID,
		StartTime: time.Now(),
		Status:    "running",
	}
	dr.mutex.Unlock()

	// Start container and stream logs
	go dr.runContainer(containerID, session.ID)

	return nil
}

func (dr *DockerRunner) prepareSessionFiles(session *Session) (string, error) {
	tempDir, err := os.MkdirTemp("", fmt.Sprintf("shadow-session-%s", session.ID))
	if err != nil {
		return "", err
	}

	// Create package.json for Node.js environment
	packageJSON := map[string]interface{}{
		"name":    "shadow-session",
		"version": "1.0.0",
		"scripts": map[string]string{
			"test": "echo \"No tests specified\"",
		},
	}

	packageData, _ := json.MarshalIndent(packageJSON, "", "  ")
	err = os.WriteFile(filepath.Join(tempDir, "package.json"), packageData, 0644)
	if err != nil {
		return "", err
	}

	// Write session state files
	for filename, content := range session.State {
		if contentStr, ok := content.(string); ok {
			filePath := filepath.Join(tempDir, filename)
			
			// Ensure directory exists
			dir := filepath.Dir(filePath)
			if err := os.MkdirAll(dir, 0755); err != nil {
				return "", err
			}
			
			if err := os.WriteFile(filePath, []byte(contentStr), 0644); err != nil {
				return "", err
			}
		}
	}

	return tempDir, nil
}

func (dr *DockerRunner) createContainer(sessionID, workDir, command string, environment []string) (string, error) {
	ctx := context.Background()

	// Prepare environment variables
	env := append(environment, 
		"NODE_ENV=test",
		fmt.Sprintf("SHADOW_SESSION_ID=%s", sessionID),
	)

	// Container configuration
	config := &container.Config{
		Image:        dr.baseImage,
		Cmd:          []string{"sh", "-c", command},
		Env:          env,
		WorkingDir:   "/workspace",
		AttachStdout: true,
		AttachStderr: true,
	}

	hostConfig := &container.HostConfig{
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeBind,
				Source: workDir,
				Target: "/workspace",
			},
		},
		AutoRemove: false, // We'll remove manually after cleanup delay
	}

	resp, err := dr.client.ContainerCreate(ctx, config, hostConfig, nil, nil, "")
	if err != nil {
		return "", err
	}

	return resp.ID, nil
}

func (dr *DockerRunner) runContainer(containerID, sessionID string) {
	ctx, cancel := context.WithTimeout(context.Background(), dr.timeout)
	defer cancel()

	startTime := time.Now()
	
	// Start container
	if err := dr.client.ContainerStart(ctx, containerID, types.ContainerStartOptions{}); err != nil {
		dr.logError(sessionID, fmt.Sprintf("Failed to start container: %v", err))
		dr.cleanup(containerID, sessionID)
		return
	}

	dr.logInfo(sessionID, "Container started")

	// Stream logs
	go dr.streamLogs(ctx, containerID, sessionID)

	// Wait for container to finish
	statusCh, errCh := dr.client.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)
	
	select {
	case err := <-errCh:
		if err != nil {
			dr.logError(sessionID, fmt.Sprintf("Container wait error: %v", err))
		}
	case status := <-statusCh:
		endTime := time.Now()
		duration := endTime.Sub(startTime)
		
		dr.logInfo(sessionID, fmt.Sprintf("Container finished with exit code %d (duration: %v)", 
			status.StatusCode, duration))
		
		// Get container logs for final output
		dr.getContainerOutput(containerID, sessionID, int(status.StatusCode), startTime, endTime)
	case <-ctx.Done():
		dr.logError(sessionID, "Container execution timed out")
		dr.client.ContainerKill(context.Background(), containerID, "SIGKILL")
	}

	// Schedule cleanup
	go func() {
		time.Sleep(5 * time.Second) // Cleanup delay
		dr.cleanup(containerID, sessionID)
	}()
}

func (dr *DockerRunner) streamLogs(ctx context.Context, containerID, sessionID string) {
	options := types.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: true,
	}

	reader, err := dr.client.ContainerLogs(ctx, containerID, options)
	if err != nil {
		dr.logError(sessionID, fmt.Sprintf("Failed to get container logs: %v", err))
		return
	}
	defer reader.Close()

	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		
		// Parse Docker log format (8-byte header + content)
		if len(line) > 8 {
			content := line[8:]
			dr.logInfo(sessionID, content)
		}
	}
}

func (dr *DockerRunner) getContainerOutput(containerID, sessionID string, exitCode int, startTime, endTime time.Time) {
	ctx := context.Background()
	
	options := types.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: false,
	}

	reader, err := dr.client.ContainerLogs(ctx, containerID, options)
	if err != nil {
		dr.logError(sessionID, fmt.Sprintf("Failed to get final output: %v", err))
		return
	}
	defer reader.Close()

	output, _ := io.ReadAll(reader)
	
	result := ExecutionResult{
		SessionID: sessionID,
		ExitCode:  exitCode,
		Output:    string(output),
		StartTime: startTime,
		EndTime:   endTime,
		Duration:  endTime.Sub(startTime).String(),
	}

	if exitCode != 0 {
		result.Error = "Non-zero exit code"
	}

	// Log final result
	resultJSON, _ := json.Marshal(result)
	dr.logInfo(sessionID, fmt.Sprintf("Execution result: %s", string(resultJSON)))
}

func (dr *DockerRunner) cleanup(containerID, sessionID string) {
	ctx := context.Background()

	// Remove container
	err := dr.client.ContainerRemove(ctx, containerID, types.ContainerRemoveOptions{
		Force: true,
	})
	if err != nil {
		log.Printf("Failed to remove container %s: %v", containerID, err)
	}

	// Remove from running containers
	dr.mutex.Lock()
	delete(dr.running, sessionID)
	dr.mutex.Unlock()

	dr.logInfo(sessionID, "Container cleaned up")
}

func (dr *DockerRunner) SubscribeToLogs(sessionID string) chan LogEntry {
	dr.logMutex.Lock()
	defer dr.logMutex.Unlock()

	logChan := make(chan LogEntry, 100)
	
	if dr.logStreams[sessionID] == nil {
		dr.logStreams[sessionID] = make([]chan LogEntry, 0)
	}
	
	dr.logStreams[sessionID] = append(dr.logStreams[sessionID], logChan)
	
	return logChan
}

func (dr *DockerRunner) UnsubscribeFromLogs(sessionID string, logChan chan LogEntry) {
	dr.logMutex.Lock()
	defer dr.logMutex.Unlock()

	streams := dr.logStreams[sessionID]
	for i, ch := range streams {
		if ch == logChan {
			// Remove channel from slice
			dr.logStreams[sessionID] = append(streams[:i], streams[i+1:]...)
			close(logChan)
			break
		}
	}
	
	// Clean up empty slice
	if len(dr.logStreams[sessionID]) == 0 {
		delete(dr.logStreams, sessionID)
	}
}

func (dr *DockerRunner) broadcastLog(entry LogEntry) {
	dr.logMutex.RLock()
	defer dr.logMutex.RUnlock()

	streams := dr.logStreams[entry.SessionID]
	for _, ch := range streams {
		select {
		case ch <- entry:
		default:
			// Channel full, skip
		}
	}
}

func (dr *DockerRunner) logInfo(sessionID, message string) {
	entry := LogEntry{
		SessionID: sessionID,
		Timestamp: time.Now(),
		Level:     "info",
		Message:   message,
		Source:    "runner",
	}
	
	log.Printf("[%s] %s", sessionID, message)
	dr.broadcastLog(entry)
}

func (dr *DockerRunner) logError(sessionID, message string) {
	entry := LogEntry{
		SessionID: sessionID,
		Timestamp: time.Now(),
		Level:     "error",
		Message:   message,
		Source:    "runner",
	}
	
	log.Printf("[%s] ERROR: %s", sessionID, message)
	dr.broadcastLog(entry)
}

func (dr *DockerRunner) GetRunningContainers() map[string]*RunningContainer {
	dr.mutex.RLock()
	defer dr.mutex.RUnlock()

	result := make(map[string]*RunningContainer)
	for k, v := range dr.running {
		result[k] = v
	}
	
	return result
}