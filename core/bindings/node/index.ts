import * as path from 'path';

// WASM module interface
interface WasmModule {
  ShadowEngine: new () => WasmShadowEngine;
}

interface WasmShadowEngine {
  initialize(shadowDir: string): Promise<void>;
  start_session(): Promise<string>;
  stop_session(): Promise<void>;
  get_status(): Promise<any>;
  get_diff_count(): Promise<number>;
  compute_ast_diffs(files: any): Promise<any[]>;
  analyze_impact(changedFiles: any): Promise<any>;
  build_dependency_graph(workspaceRoot: string): Promise<void>;
}

interface SessionStatus {
  isActive: boolean;
  sessionId?: string;
  startTime?: string;
}

export class ShadowEngine {
  private wasmEngine?: WasmShadowEngine;
  private wasmModule?: WasmModule;

  constructor() {
    // WASM module will be loaded dynamically
  }

  async initialize(shadowDir: string): Promise<void> {
    try {
      // Load WASM module
      const wasmPath = path.join(__dirname, 'pkg', 'shadow_core.js');
      this.wasmModule = (require as any)(wasmPath);
      this.wasmEngine = new this.wasmModule!.ShadowEngine();
      
      await this.wasmEngine.initialize(shadowDir);
    } catch (error) {
      // Fallback implementation for development
      console.warn('WASM module not available, using fallback implementation');
      this.initializeFallback(shadowDir);
    }
  }

  async startSession(): Promise<string> {
    if (this.wasmEngine) {
      return await this.wasmEngine.start_session();
    }
    return this.startSessionFallback();
  }

  async stopSession(): Promise<void> {
    if (this.wasmEngine) {
      await this.wasmEngine.stop_session();
    } else {
      this.stopSessionFallback();
    }
  }

  async getStatus(): Promise<SessionStatus> {
    if (this.wasmEngine) {
      const status = await this.wasmEngine.get_status();
      return {
        isActive: status.is_active,
        sessionId: status.session_id,
        startTime: status.start_time
      };
    }
    return this.getStatusFallback();
  }

  async getDiffCount(): Promise<number> {
    if (this.wasmEngine) {
      return await this.wasmEngine.get_diff_count();
    }
    return this.getDiffCountFallback();
  }

  async computeAstDiffs(fileChanges: Array<[string, string, string]>): Promise<any[]> {
    if (this.wasmEngine) {
      return await this.wasmEngine.compute_ast_diffs(fileChanges);
    }
    return this.computeAstDiffsFallback(fileChanges);
  }

  async analyzeImpact(changedFiles: string[]): Promise<any> {
    if (this.wasmEngine) {
      return await this.wasmEngine.analyze_impact(changedFiles);
    }
    return this.analyzeImpactFallback(changedFiles);
  }

  async buildDependencyGraph(workspaceRoot: string): Promise<void> {
    if (this.wasmEngine) {
      await this.wasmEngine.build_dependency_graph(workspaceRoot);
    } else {
      this.buildDependencyGraphFallback(workspaceRoot);
    }
  }

  // Fallback implementations for development
  private fallbackSession: { id: string; startTime: string; active: boolean } | null = null;

  private initializeFallback(shadowDir: string): void {
    // Simple fallback initialization
  }

  private startSessionFallback(): string {
    const sessionId = `session_${Date.now()}`;
    this.fallbackSession = {
      id: sessionId,
      startTime: new Date().toISOString(),
      active: true
    };
    return sessionId;
  }

  private stopSessionFallback(): void {
    this.fallbackSession = null;
  }

  private getStatusFallback(): SessionStatus {
    if (this.fallbackSession) {
      return {
        isActive: this.fallbackSession.active,
        sessionId: this.fallbackSession.id,
        startTime: this.fallbackSession.startTime
      };
    }
    return { isActive: false };
  }

  private getDiffCountFallback(): number {
    return 0;
  }

  private computeAstDiffsFallback(fileChanges: Array<[string, string, string]>): any[] {
    // Simple fallback - detect basic changes
    const diffs = [];
    
    for (const [filePath, oldContent, newContent] of fileChanges) {
      if (oldContent !== newContent) {
        diffs.push({
          filePath,
          changes: [{
            changeType: 'Modified',
            nodeType: 'Unknown',
            name: path.basename(filePath),
            lineRange: [1, newContent.split('\n').length]
          }]
        });
      }
    }
    
    return diffs;
  }

  private analyzeImpactFallback(changedFiles: string[]): any {
    return {
      changedFiles,
      impactedFiles: [],
      riskLevel: changedFiles.length > 3 ? 'high' : changedFiles.length > 1 ? 'medium' : 'low'
    };
  }

  private buildDependencyGraphFallback(workspaceRoot: string): void {
    // Fallback - no-op for development
  }
}