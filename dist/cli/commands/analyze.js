"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyzeCommand = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const node_1 = require("../../core/bindings/node");
class AnalyzeCommand {
    async execute() {
        const shadowDir = '.shadow';
        const sessionLogPath = path.join(shadowDir, 'session.log');
        try {
            // Check if shadow is initialized
            if (!await fs.pathExists(shadowDir)) {
                console.log('Error: Shadow not initialized. Run "shadow init" first.');
                process.exit(1);
            }
            // Initialize engine
            const engine = new node_1.ShadowEngine();
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
            const result = {
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
        }
        catch (error) {
            console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            process.exit(1);
        }
    }
    async getChangedFiles(shadowDir) {
        const changedFiles = [];
        const shadowPath = path.resolve(shadowDir);
        try {
            // Scan shadow directory for files
            await this.scanDirectory(shadowPath, shadowPath, changedFiles);
        }
        catch (error) {
            // If no files in shadow, return empty
        }
        return changedFiles;
    }
    async scanDirectory(dirPath, basePath, files) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
                await this.scanDirectory(fullPath, basePath, files);
            }
            else if (entry.isFile() && this.isSupportedFile(entry.name)) {
                const content = await fs.readFile(fullPath, 'utf8');
                const relativePath = path.relative(basePath, fullPath);
                files.push({ path: relativePath, content });
            }
        }
    }
    isSupportedFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ['.ts', '.js', '.tsx', '.jsx'].includes(ext);
    }
    async prepareFileChanges(changedFiles) {
        const fileChanges = [];
        for (const file of changedFiles) {
            // Try to get original content from workspace
            const workspacePath = path.resolve(file.path);
            let originalContent = '';
            try {
                if (await fs.pathExists(workspacePath)) {
                    originalContent = await fs.readFile(workspacePath, 'utf8');
                }
            }
            catch (error) {
                // File might be new, use empty string as original
            }
            fileChanges.push([file.path, originalContent, file.content]);
        }
        return fileChanges;
    }
    async callAiObserver(astDiffs, impactAnalysis, changedFiles) {
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
            const python = (0, child_process_1.spawn)('python3', args, { stdio: ['pipe', 'pipe', 'pipe'] });
            let output = '';
            let error = '';
            python.stdout.on('data', (data) => {
                output += data.toString();
            });
            python.stderr.on('data', (data) => {
                error += data.toString();
            });
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        resolve(result);
                    }
                    catch (parseError) {
                        // Fallback if JSON parsing fails
                        resolve({
                            changed: this.extractChangedEntities(astDiffs),
                            impacted: impactAnalysis.impactedFiles || [],
                            risk: impactAnalysis.riskLevel || 'medium',
                            summary: 'Analysis completed with fallback parser'
                        });
                    }
                }
                else {
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
    extractChangedEntities(astDiffs) {
        const entities = [];
        for (const diff of astDiffs) {
            for (const change of diff.changes || []) {
                if (change.name) {
                    entities.push(`${change.nodeType}.${change.name}`);
                }
            }
        }
        return entities;
    }
    generateSummary(astDiffs, impactAnalysis, observerResult) {
        const changeCount = astDiffs.reduce((sum, diff) => sum + (diff.changes?.length || 0), 0);
        const impactCount = impactAnalysis.impactedFiles?.length || 0;
        const risk = observerResult.risk || 'unknown';
        return `${changeCount} AST changes, ${impactCount} files impacted, risk: ${risk}`;
    }
}
exports.AnalyzeCommand = AnalyzeCommand;
//# sourceMappingURL=analyze.js.map