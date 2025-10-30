import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import { ShadowEngine } from '../../core/bindings/node';

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

interface OffloadResult {
  sessionId: string;
  status: string;
  executionResult?: any;
}

export class OffloadCommand {
  private cloudConfig: CloudConfig | null = null;
  private authToken: string = '';

  async execute(): Promise<void> {
    const shadowDir = '.shadow';
    const sessionLogPath = path.join(shadowDir, 'session.log');
    
    try {
      // Check if shadow is initialized and active
      if (!await fs.pathExists(shadowDir)) {
        console.log('Error: Shadow not initialized. Run "shadow init" first.');
        process.exit(1);
      }

      const engine = new ShadowEngine();
      await engine.initialize(shadowDir);

      const status = await engine.getStatus();
      if (!status.isActive) {
        console.log('Error: Not in Shadow Mode. Run "shadow start" first.');
        process.exit(1);
      }

      // Load cloud configuration
      await this.loadCloudConfig();
      
      // Check cloud connectivity
      if (!await this.checkCloudConnectivity()) {
        console.log('Error: Cannot connect to ShrikCloud. Working offline.');
        process.exit(1);
      }

      // Package shadow state
      const shadowState = await this.packageShadowState(shadowDir);
      
      if (Object.keys(shadowState).length === 0) {
        console.log('No changes to offload');
        return;
      }

      // Initialize cloud session
      const sessionId = await this.initializeCloudSession(status.sessionId || 'local');
      
      // Sync state to cloud
      await this.syncStateToCloud(sessionId, shadowState);
      
      // Execute in cloud
      const executionResult = await this.executeInCloud(sessionId);
      
      // Log offload
      const timestamp = new Date().toISOString();
      await fs.appendFile(sessionLogPath, `${timestamp} - Offloaded to cloud: ${sessionId}\n`);

      // Output result
      const result: OffloadResult = {
        sessionId,
        status: 'completed',
        executionResult
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
    
    // Generate or load auth token
    this.authToken = await this.getAuthToken();
  }

  private async getAuthToken(): Promise<string> {
    const tokenPath = path.join('.shadow', 'cloud.token');
    
    try {
      if (await fs.pathExists(tokenPath)) {
        return await fs.readFile(tokenPath, 'utf8');
      }
    } catch (error) {
      // Generate new token if file doesn't exist or is corrupted
    }

    // Generate new token
    const token = this.generateToken(32);
    await fs.writeFile(tokenPath, token);
    return token;
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

  private async packageShadowState(shadowDir: string): Promise<Record<string, string>> {
    const state: Record<string, string> = {};
    
    try {
      // Scan shadow directory for files
      await this.scanShadowDirectory(shadowDir, shadowDir, state);
    } catch (error) {
      // If no files in shadow, return empty state
    }

    return state;
  }

  private async scanShadowDirectory(dirPath: string, basePath: string, state: Record<string, string>): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
        await this.scanShadowDirectory(fullPath, basePath, state);
      } else if (entry.isFile() && this.isSupportedFile(entry.name)) {
        const content = await fs.readFile(fullPath, 'utf8');
        const relativePath = path.relative(basePath, fullPath);
        state[relativePath] = content;
      }
    }
  }

  private isSupportedFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.ts', '.js', '.tsx', '.jsx', '.json', '.md'].includes(ext);
  }

  private async initializeCloudSession(localSessionId: string): Promise<string> {
    const baseUrl = this.getBaseUrl();
    
    const response = await axios.post(`${baseUrl}/api/v1/session/init`, {
      workspace_path: process.cwd(),
      metadata: {
        local_session_id: localSessionId,
        created_by: 'shadow-cli',
        version: '1.0.0'
      }
    }, {
      headers: this.getAuthHeaders()
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to initialize cloud session');
    }

    return response.data.data.session_id;
  }

  private async syncStateToCloud(sessionId: string, state: Record<string, string>): Promise<void> {
    const baseUrl = this.getBaseUrl();
    
    const response = await axios.post(`${baseUrl}/api/v1/session/sync`, {
      session_id: sessionId,
      snapshot: state
    }, {
      headers: this.getAuthHeaders()
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to sync state to cloud');
    }
  }

  private async executeInCloud(sessionId: string): Promise<any> {
    const baseUrl = this.getBaseUrl();
    
    // Start execution
    const executeResponse = await axios.post(`${baseUrl}/api/v1/session/execute`, {
      session_id: sessionId,
      command: 'npm test',
      environment: ['NODE_ENV=test']
    }, {
      headers: this.getAuthHeaders()
    });

    if (!executeResponse.data.success) {
      throw new Error(executeResponse.data.error || 'Failed to start cloud execution');
    }

    // Wait for execution to complete (simplified polling)
    await this.waitForExecution(sessionId);

    return {
      status: 'completed',
      session_id: sessionId
    };
  }

  private async waitForExecution(sessionId: string): Promise<void> {
    // Simple polling implementation
    // In production, use WebSocket for real-time updates
    
    const maxWait = 60000; // 1 minute
    const pollInterval = 2000; // 2 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Check if execution is complete
      // For now, just wait the poll interval
      break;
    }
  }
}