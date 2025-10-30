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
exports.ShadowEngine = void 0;
const path = __importStar(require("path"));
class ShadowEngine {
    constructor() {
        // Fallback implementations for development
        this.fallbackSession = null;
        // WASM module will be loaded dynamically
    }
    async initialize(shadowDir) {
        try {
            // Load WASM module
            const wasmPath = path.join(__dirname, 'pkg', 'shadow_core.js');
            this.wasmModule = require(wasmPath);
            this.wasmEngine = new this.wasmModule.ShadowEngine();
            await this.wasmEngine.initialize(shadowDir);
        }
        catch (error) {
            // Fallback implementation for development
            console.warn('WASM module not available, using fallback implementation');
            this.initializeFallback(shadowDir);
        }
    }
    async startSession() {
        if (this.wasmEngine) {
            return await this.wasmEngine.start_session();
        }
        return this.startSessionFallback();
    }
    async stopSession() {
        if (this.wasmEngine) {
            await this.wasmEngine.stop_session();
        }
        else {
            this.stopSessionFallback();
        }
    }
    async getStatus() {
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
    async getDiffCount() {
        if (this.wasmEngine) {
            return await this.wasmEngine.get_diff_count();
        }
        return this.getDiffCountFallback();
    }
    async computeAstDiffs(fileChanges) {
        if (this.wasmEngine) {
            return await this.wasmEngine.compute_ast_diffs(fileChanges);
        }
        return this.computeAstDiffsFallback(fileChanges);
    }
    async analyzeImpact(changedFiles) {
        if (this.wasmEngine) {
            return await this.wasmEngine.analyze_impact(changedFiles);
        }
        return this.analyzeImpactFallback(changedFiles);
    }
    async buildDependencyGraph(workspaceRoot) {
        if (this.wasmEngine) {
            await this.wasmEngine.build_dependency_graph(workspaceRoot);
        }
        else {
            this.buildDependencyGraphFallback(workspaceRoot);
        }
    }
    initializeFallback(shadowDir) {
        // Simple fallback initialization
    }
    startSessionFallback() {
        const sessionId = `session_${Date.now()}`;
        this.fallbackSession = {
            id: sessionId,
            startTime: new Date().toISOString(),
            active: true
        };
        return sessionId;
    }
    stopSessionFallback() {
        this.fallbackSession = null;
    }
    getStatusFallback() {
        if (this.fallbackSession) {
            return {
                isActive: this.fallbackSession.active,
                sessionId: this.fallbackSession.id,
                startTime: this.fallbackSession.startTime
            };
        }
        return { isActive: false };
    }
    getDiffCountFallback() {
        return 0;
    }
    computeAstDiffsFallback(fileChanges) {
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
    analyzeImpactFallback(changedFiles) {
        return {
            changedFiles,
            impactedFiles: [],
            riskLevel: changedFiles.length > 3 ? 'high' : changedFiles.length > 1 ? 'medium' : 'low'
        };
    }
    buildDependencyGraphFallback(workspaceRoot) {
        // Fallback - no-op for development
    }
}
exports.ShadowEngine = ShadowEngine;
//# sourceMappingURL=index.js.map