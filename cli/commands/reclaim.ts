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

export class ReclaimCommand {
  private cloudConfig: CloudConfig | null = null;
  private authToken: string = '';

  async execute(sessionId?: string): Promise<void> {
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
        console.log('Error: Cannot connect to ShrikCloud. Working offline.');
        process.exit(1);
      }

      // Get session ID
      const targetSessionId = sessionId || await this.getLatestSessionId();
      
      if (!targetSessionId) {
        console.log('No cloud session found to reclaim');
        return;
      }

      // Get session data from cloud
      const sessionData = await this.getSessionFromCloud(targetSessionId);
      
      // Download artifacts and state
      const artifacts = await this.downloadArtifacts(targetSessionId, sessionData);
      
      // Apply artifacts to shadow workspace
      await this.applyArtifacts(shadowDir, artifacts);
      
      // Log reclaim
      const timestamp = new Date().toISOString();
      await fs.appendFile(sessionLogPath, `${timestamp} - Reclaimed from cloud: ${targetSessionId}\n`);

      console.log(JSON.stringify({
        success: true,
        session_id: targetSessionId,
        artifacts_count: Object.keys(artifacts).length,
        message: 'Successfully reclaimed cloud session'
      }, null, 2));

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
      throw new Error('No auth token found. Run "shadow offload" first.');
    }
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

  private async getLatestSessionId(): Promise<string | null> {
    const baseUrl = this.getBaseUrl();
    
    const response = await axios.get(`${baseUrl}/api/v1/session/list`, {
      headers: this.getAuthHeaders()
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to list sessions');
    }

    const sessions = response.data.data.sessions;
    if (!sessions || sessions.length === 0) {
      return null;
    }

    // Return the most recent session
    const sortedSessions = sessions.sort((a: any, b: any) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return sortedSessions[0].id;
  }

  private async getSessionFromCloud(sessionId: string): Promise<any> {
    const baseUrl = this.getBaseUrl();
    
    const response = await axios.get(`${baseUrl}/api/v1/session/${sessionId}`, {
      headers: this.getAuthHeaders()
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to get session from cloud');
    }

    return response.data.data;
  }

  private async downloadArtifacts(sessionId: string, sessionData: any): Promise<Record<string, string>> {
    const artifacts: Record<string, string> = {};
    
    // Extract state from session data
    if (sessionData.state) {
      for (const [filePath, content] of Object.entries(sessionData.state)) {
        if (typeof content === 'string') {
          artifacts[filePath] = content;
        }
      }
    }

    // In a full implementation, this would also download:
    // - Build artifacts
    // - Test results
    // - Generated files
    // - Log files

    return artifacts;
  }

  private async applyArtifacts(shadowDir: string, artifacts: Record<string, string>): Promise<void> {
    for (const [filePath, content] of Object.entries(artifacts)) {
      // Only apply files that should be in shadow workspace
      if (this.shouldApplyToShadow(filePath)) {
        const fullPath = path.join(shadowDir, filePath);
        
        // Ensure directory exists
        const dir = path.dirname(fullPath);
        await fs.ensureDir(dir);
        
        // Write file content
        await fs.writeFile(fullPath, content, 'utf8');
      }
    }
  }

  private shouldApplyToShadow(filePath: string): boolean {
    // Only apply certain file types to shadow workspace
    const ext = path.extname(filePath).toLowerCase();
    const allowedExtensions = ['.ts', '.js', '.tsx', '.jsx', '.json'];
    
    // Don't apply system files
    if (filePath.startsWith('.') || filePath.includes('node_modules')) {
      return false;
    }
    
    return allowedExtensions.includes(ext);
  }
}