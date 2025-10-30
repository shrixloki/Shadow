import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ShadowEngine } from '../../core/bindings/node';

interface AnalysisResult {
  astDiffs: any[];
  impactAnalysis: any;
  observerResult: any;
  summary: string;
}

export class AnalyzeCommand {
  async execute(): Promise<void> {
    const shadowDir = '.shadow';
    const sessionLogPath = path.join(shadowDir, 'session.log');
    
    try {
      // Check if shadow is initialized
      if (!await fs.pathExists(shadowDir)) {
        console.log('Error: Shadow not initialized. Run "shadow init" first.');
        process.exit(1);
      }

      // Initialize engine
      const engine = new ShadowEngine();
      await engine.initialize(shadowDir);

      // Check if in shadow mode
      const status = await engine.getStatus();
      if (!status.isActive) {
        console.log('Error: Not in Shadow Mode. Run "shadow start" first.');
        process.exit(1);
      }

      // Build dependency graph
      await engine.buildDependencyGraph(process.cwd());

      // Get changed files from shadow directory
      const changedFiles = await this.getChangedFiles(shadowDir);
      
      if (changedFiles.length === 0) {
        console.log('No changes detected in shadow workspace');
        return;
      }

      // Compute AST diffs
      const fileChanges = await this.prepareFileChanges(changedFiles);
      const astDiffs = await engine.computeAstDiffs(fileChanges);

      // Analyze impact
      const impactAnalysis = await engine.analyzeImpact(changedFiles.map(f => f.path));

      // Call AI Observer
      const observerResult = await this.callAiObserver(astDiffs, impactAnalysis, changedFiles.map(f => f.path));

      // Generate analysis result
      const result: AnalysisResult = {
        astDiffs,
        impactAnalysis,
        observerResult,
        summary: this.generateSummary(astDiffs, impactAnalysis, observerResult)
      };

      // Output results
      console.log(JSON.stringify(result, null, 2));

      // Log analysis
      const timestamp = new Date().toISOString();
      await fs.appendFile(sessionLogPath, `${timestamp} - Analysis completed: ${result.summary}\n`);

    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }

  private async getChangedFiles(shadowDir: string): Promise<Array<{path: string, content: string}>> {
    const changedFiles: Array<{path: string, content: string}> = [];
    const shadowPath = path.resolve(shadowDir);
    
    try {
      // Scan shadow directory for files
      await this.scanDirectory(shadowPath, shadowPath, changedFiles);
    } catch (error) {
      // If no files in shadow, return empty
    }

    return changedFiles;
  }

  private async scanDirectory(dirPath: string, basePath: string, files: Array<{path: string, content: string}>): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
        await this.scanDirectory(fullPath, basePath, files);
      } else if (entry.isFile() && this.isSupportedFile(entry.name)) {
        const content = await fs.readFile(fullPath, 'utf8');
        const relativePath = path.relative(basePath, fullPath);
        files.push({ path: relativePath, content });
      }
    }
  }

  private isSupportedFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.ts', '.js', '.tsx', '.jsx'].includes(ext);
  }

  private async prepareFileChanges(changedFiles: Array<{path: string, content: string}>): Promise<Array<[string, string, string]>> {
    const fileChanges: Array<[string, string, string]> = [];
    
    for (const file of changedFiles) {
      // Try to get original content from workspace
      const workspacePath = path.resolve(file.path);
      let originalContent = '';
      
      try {
        if (await fs.pathExists(workspacePath)) {
          originalContent = await fs.readFile(workspacePath, 'utf8');
        }
      } catch (error) {
        // File might be new, use empty string as original
      }
      
      fileChanges.push([file.path, originalContent, file.content]);
    }
    
    return fileChanges;
  }

  private async callAiObserver(astDiffs: any[], impactAnalysis: any, changedFiles: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const observerPath = path.join('ai_observer', 'observer.py');
      
      // Check if Python observer exists
      if (!fs.existsSync(observerPath)) {
        // Return fallback analysis
        resolve({
          changed: this.extractChangedEntities(astDiffs),
          impacted: impactAnalysis.impactedFiles || [],
          risk: impactAnalysis.riskLevel || 'medium',
          summary: 'Fallback analysis - Python observer not available'
        });
        return;
      }

      const args = [
        observerPath,
        'analyze',
        JSON.stringify(astDiffs),
        JSON.stringify({ edges: {} }), // Simplified dep graph
        JSON.stringify(changedFiles)
      ];

      const python = spawn('python3', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      
      let output = '';
      let error = '';

      python.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      python.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });

      python.on('close', (code: number | null) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch (parseError) {
            // Fallback if JSON parsing fails
            resolve({
              changed: this.extractChangedEntities(astDiffs),
              impacted: impactAnalysis.impactedFiles || [],
              risk: impactAnalysis.riskLevel || 'medium',
              summary: 'Analysis completed with fallback parser'
            });
          }
        } else {
          // Fallback on error
          resolve({
            changed: this.extractChangedEntities(astDiffs),
            impacted: impactAnalysis.impactedFiles || [],
            risk: impactAnalysis.riskLevel || 'medium',
            summary: 'Analysis completed with fallback (observer error)'
          });
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        python.kill();
        resolve({
          changed: this.extractChangedEntities(astDiffs),
          impacted: impactAnalysis.impactedFiles || [],
          risk: impactAnalysis.riskLevel || 'medium',
          summary: 'Analysis completed with fallback (timeout)'
        });
      }, 10000);
    });
  }

  private extractChangedEntities(astDiffs: any[]): string[] {
    const entities: string[] = [];
    
    for (const diff of astDiffs) {
      for (const change of diff.changes || []) {
        if (change.name) {
          entities.push(`${change.nodeType}.${change.name}`);
        }
      }
    }
    
    return entities;
  }

  private generateSummary(astDiffs: any[], impactAnalysis: any, observerResult: any): string {
    const changeCount = astDiffs.reduce((sum, diff) => sum + (diff.changes?.length || 0), 0);
    const impactCount = impactAnalysis.impactedFiles?.length || 0;
    const risk = observerResult.risk || 'unknown';
    
    return `${changeCount} AST changes, ${impactCount} files impacted, risk: ${risk}`;
  }
}