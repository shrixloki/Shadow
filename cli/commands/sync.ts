import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';

interface CloudConfig {
  api: {
    host: string;
    port: number;
    tls: {
      enabled: boolean;
    };
  };
  auth: {
    token_header: string;
  };
}

interface SyncResult {
  success: boolean;
  synced_sessions: string[];
  metadata_count: number;
  message: string;
}

export class SyncCommand {
  private cloudConfig: CloudConfig | null = null;
  private authToken: string = '';

  async execute(): Promise<void> {
    const shadowDir = '.shadow';
    const sessionLogPath = path.join(shadowDir, 'session.log');
    
    try {
      // Check if shadow is initialized
      if (!await fs.pathExists(shadowDir)) {
        console.log('Error: Shadow not initialized. Run "shadow init" first.');
        process.exit(1);
      }

      // Load cloud configuration
      await this.loadCloudConfig();
      
      // Check cloud connectivity
      if (!await this.checkCloudConnectivity()) {
        console.log('Warning: Cannot connect to ShrikCloud. Metadata cached locally.');
        await this.syncOffline();
        return;
      }

      // Sync session metadata to cloud vault
      const localMetadata = await this.gatherLocalMetadata(shadowDir);
      const syncedSessions = await this.syncMetadataToCloud(localMetadata);
      
      // Update local sync status
      await this.updateLocalSyncStatus(shadowDir, syncedSessions);
      
      // Log sync
      const timestamp = new Date().toISOString();
      await fs.appendFile(sessionLogPath, `${timestamp} - Synced metadata to cloud vault\n`);

      const result: SyncResult = {
        success: true,
        synced_sessions: syncedSessions,
        metadata_count: Object.keys(localMetadata).length,
        message: 'Metadata synced to cloud vault'
      };

      console.log(JSON.stringify(result, null, 2));

    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }

  private async loadCloudConfig(): Promise<void> {
    const configPath = path.join('cloud', 'config', 'cloud.config.json');
    
    if (!await fs.pathExists(configPath)) {
      throw new Error('Cloud configuration not found');
    }

    this.cloudConfig = await fs.readJson(configPath);
    
    // Load auth token
    const tokenPath = path.join('.shadow', 'cloud.token');
    if (await fs.pathExists(tokenPath)) {
      this.authToken = await fs.readFile(tokenPath, 'utf8');
    } else {
      // Generate token for sync
      this.authToken = this.generateToken(32);
      await fs.writeFile(tokenPath, this.authToken);
    }
  }

  private generateToken(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async checkCloudConnectivity(): Promise<boolean> {
    if (!this.cloudConfig) return false;

    try {
      const baseUrl = this.getBaseUrl();
      const response = await axios.get(`${baseUrl}/api/v1/session/list`, {
        headers: this.getAuthHeaders(),
        timeout: 5000
      });
      
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private getBaseUrl(): string {
    if (!this.cloudConfig) throw new Error('Cloud config not loaded');
    
    const protocol = this.cloudConfig.api.tls.enabled ? 'https' : 'http';
    return `${protocol}://${this.cloudConfig.api.host}:${this.cloudConfig.api.port}`;
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.cloudConfig) throw new Error('Cloud config not loaded');
    
    return {
      [this.cloudConfig.auth.token_header]: this.authToken,
      'Content-Type': 'application/json'
    };
  }

  private async gatherLocalMetadata(shadowDir: string): Promise<Record<string, any>> {
    const metadata: Record<string, any> = {};
    
    // Read session log for timeline
    const sessionLogPath = path.join(shadowDir, 'session.log');
    if (await fs.pathExists(sessionLogPath)) {
      const logContent = await fs.readFile(sessionLogPath, 'utf8');
      metadata.session_timeline = this.parseSessionLog(logContent);
    }

    // Gather session database info (if accessible)
    const sessionDbPath = path.join(shadowDir, 'session.db');
    if (await fs.pathExists(sessionDbPath)) {
      const stats = await fs.stat(sessionDbPath);
      metadata.session_db = {
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime
      };
    }

    // Gather workspace info
    metadata.workspace = {
      path: process.cwd(),
      shadow_dir: shadowDir,
      timestamp: new Date().toISOString()
    };

    // Count files in shadow
    try {
      const fileCount = await this.countShadowFiles(shadowDir);
      metadata.file_stats = fileCount;
    } catch (error) {
      metadata.file_stats = { error: 'Could not count files' };
    }

    return metadata;
  }

  private parseSessionLog(logContent: string): any[] {
    const lines = logContent.split('\n').filter(line => line.trim());
    const events = [];

    for (const line of lines) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) - (.+)$/);
      if (match) {
        events.push({
          timestamp: match[1],
          event: match[2]
        });
      }
    }

    return events;
  }

  private async countShadowFiles(shadowDir: string): Promise<any> {
    const stats = {
      total_files: 0,
      by_extension: {} as Record<string, number>,
      total_size: 0
    };

    await this.countFilesRecursive(shadowDir, shadowDir, stats);
    return stats;
  }

  private async countFilesRecursive(dirPath: string, basePath: string, stats: any): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
          await this.countFilesRecursive(fullPath, basePath, stats);
        } else if (entry.isFile()) {
          stats.total_files++;
          
          const ext = path.extname(entry.name).toLowerCase() || 'no_extension';
          stats.by_extension[ext] = (stats.by_extension[ext] || 0) + 1;
          
          try {
            const fileStat = await fs.stat(fullPath);
            stats.total_size += fileStat.size;
          } catch (error) {
            // Skip files we can't stat
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  private async syncMetadataToCloud(metadata: Record<string, any>): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    const syncedSessions: string[] = [];

    // Create a metadata session
    const sessionResponse = await axios.post(`${baseUrl}/api/v1/session/init`, {
      workspace_path: metadata.workspace?.path || process.cwd(),
      metadata: {
        type: 'metadata_sync',
        created_by: 'shadow-sync',
        version: '1.0.0'
      }
    }, {
      headers: this.getAuthHeaders()
    });

    if (!sessionResponse.data.success) {
      throw new Error(sessionResponse.data.error || 'Failed to create metadata session');
    }

    const sessionId = sessionResponse.data.data.session_id;
    syncedSessions.push(sessionId);

    // Sync metadata as session state
    const syncResponse = await axios.post(`${baseUrl}/api/v1/session/sync`, {
      session_id: sessionId,
      snapshot: {
        'metadata.json': JSON.stringify(metadata, null, 2)
      }
    }, {
      headers: this.getAuthHeaders()
    });

    if (!syncResponse.data.success) {
      throw new Error(syncResponse.data.error || 'Failed to sync metadata');
    }

    return syncedSessions;
  }

  private async updateLocalSyncStatus(shadowDir: string, syncedSessions: string[]): Promise<void> {
    const syncStatusPath = path.join(shadowDir, 'sync_status.json');
    
    const syncStatus = {
      last_sync: new Date().toISOString(),
      synced_sessions: syncedSessions,
      sync_count: syncedSessions.length
    };

    await fs.writeFile(syncStatusPath, JSON.stringify(syncStatus, null, 2));
  }

  private async syncOffline(): Promise<void> {
    const shadowDir = '.shadow';
    const offlineSyncPath = path.join(shadowDir, 'offline_sync.json');
    
    const metadata = await this.gatherLocalMetadata(shadowDir);
    
    const offlineSync = {
      timestamp: new Date().toISOString(),
      metadata,
      status: 'offline'
    };

    await fs.writeFile(offlineSyncPath, JSON.stringify(offlineSync, null, 2));
    
    console.log(JSON.stringify({
      success: true,
      message: 'Metadata cached locally (offline mode)',
      cached_at: offlineSync.timestamp
    }, null, 2));
  }
}