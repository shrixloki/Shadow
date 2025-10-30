import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

interface Session {
  id: string;
  workspace_path: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface LogEntry {
  session_id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

const API_BASE = 'http://localhost:8080/api/v1';
const WS_BASE = 'ws://localhost:8080/ws';
const AUTH_TOKEN = 'shadow-dashboard-token-12345678901234567890';

const Dashboard: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSession) {
      connectToLogs(selectedSession);
    } else if (ws) {
      ws.close();
      setWs(null);
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      const response = await fetch(`${API_BASE}/session/list`, {
        headers: {
          'X-Shadow-Token': AUTH_TOKEN
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSessions(data.data.sessions || []);
          setConnected(true);
        }
      }
    } catch (error) {
      setConnected(false);
      console.error('Failed to load sessions:', error);
    }
  };

  const connectToLogs = (sessionId: string) => {
    if (ws) {
      ws.close();
    }

    const websocket = new WebSocket(`${WS_BASE}/logs/${sessionId}`);
    
    websocket.onopen = () => {
      console.log('Connected to log stream for session:', sessionId);
      setLogs([]); // Clear previous logs
    };

    websocket.onmessage = (event) => {
      try {
        const logEntry: LogEntry = JSON.parse(event.data);
        setLogs(prev => [...prev, logEntry]);
      } catch (error) {
        console.error('Failed to parse log entry:', error);
      }
    };

    websocket.onclose = () => {
      console.log('Disconnected from log stream');
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(websocket);
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return '#22c55e';
      case 'completed': return '#3b82f6';
      case 'failed': return '#ef4444';
      case 'created': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#ef4444';
      case 'warn': return '#f59e0b';
      case 'info': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: '20px', backgroundColor: '#1a1a1a', color: '#e5e5e5', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>Shadow Dashboard</h1>
        <div style={{ 
          marginLeft: '20px', 
          padding: '4px 8px', 
          borderRadius: '4px', 
          backgroundColor: connected ? '#22c55e' : '#ef4444',
          fontSize: '12px'
        }}>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', height: 'calc(100vh - 100px)' }}>
        {/* Sessions Panel */}
        <div style={{ backgroundColor: '#2a2a2a', padding: '15px', borderRadius: '8px', overflow: 'auto' }}>
          <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>Active Sessions</h2>
          
          {sessions.length === 0 ? (
            <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>No active sessions</div>
          ) : (
            sessions.map(session => (
              <div
                key={session.id}
                onClick={() => setSelectedSession(session.id)}
                style={{
                  padding: '10px',
                  marginBottom: '8px',
                  backgroundColor: selectedSession === session.id ? '#374151' : '#1f2937',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: selectedSession === session.id ? '2px solid #3b82f6' : '2px solid transparent'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    {session.id.substring(0, 8)}...
                  </div>
                  <div style={{ 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    backgroundColor: getStatusColor(session.status),
                    fontSize: '12px',
                    color: 'white'
                  }}>
                    {session.status}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                  Created: {formatTimestamp(session.created_at)}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                  Updated: {formatTimestamp(session.updated_at)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Logs Panel */}
        <div style={{ backgroundColor: '#2a2a2a', padding: '15px', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
            Logs {selectedSession && `- ${selectedSession.substring(0, 8)}...`}
          </h2>
          
          <div style={{ 
            flex: 1, 
            overflow: 'auto', 
            backgroundColor: '#1a1a1a', 
            padding: '10px', 
            borderRadius: '6px',
            fontSize: '13px',
            lineHeight: '1.4'
          }}>
            {!selectedSession ? (
              <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                Select a session to view logs
              </div>
            ) : logs.length === 0 ? (
              <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                No logs available
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#6b7280' }}>
                    {formatTimestamp(log.timestamp)}
                  </span>
                  <span style={{ 
                    color: getLevelColor(log.level), 
                    marginLeft: '8px',
                    fontWeight: 'bold'
                  }}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span style={{ marginLeft: '8px', color: '#d1d5db' }}>
                    {log.message}
                  </span>
                  {log.source && (
                    <span style={{ color: '#6b7280', marginLeft: '8px', fontSize: '11px' }}>
                      ({log.source})
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Initialize React app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Dashboard />);
}