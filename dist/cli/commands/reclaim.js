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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReclaimCommand = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
class ReclaimCommand {
    constructor() {
        this.cloudConfig = null;
        this.authToken = '';
    }
    async execute(sessionId) {
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
        }
        catch (error) {
            console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            process.exit(1);
        }
    }
    async loadCloudConfig() {
        const configPath = path.join('cloud', 'config', 'cloud.config.json');
        if (!await fs.pathExists(configPath)) {
            throw new Error('Cloud configuration not found');
        }
        this.cloudConfig = await fs.readJson(configPath);
        // Load auth token
        const tokenPath = path.join('.shadow', 'cloud.token');
        if (await fs.pathExists(tokenPath)) {
            this.authToken = await fs.readFile(tokenPath, 'utf8');
        }
        else {
            throw new Error('No auth token found. Run "shadow offload" first.');
        }
    }
    async checkCloudConnectivity() {
        if (!this.cloudConfig)
            return false;
        try {
            const baseUrl = this.getBaseUrl();
            const response = await axios_1.default.get(`${baseUrl}/api/v1/session/list`, {
                headers: this.getAuthHeaders(),
                timeout: 5000
            });
            return response.status === 200;
        }
        catch (error) {
            return false;
        }
    }
    getBaseUrl() {
        if (!this.cloudConfig)
            throw new Error('Cloud config not loaded');
        const protocol = this.cloudConfig.api.tls.enabled ? 'https' : 'http';
        return `${protocol}://${this.cloudConfig.api.host}:${this.cloudConfig.api.port}`;
    }
    getAuthHeaders() {
        if (!this.cloudConfig)
            throw new Error('Cloud config not loaded');
        return {
            [this.cloudConfig.auth.token_header]: this.authToken,
            'Content-Type': 'application/json'
        };
    }
    async getLatestSessionId() {
        const baseUrl = this.getBaseUrl();
        const response = await axios_1.default.get(`${baseUrl}/api/v1/session/list`, {
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
        const sortedSessions = sessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return sortedSessions[0].id;
    }
    async getSessionFromCloud(sessionId) {
        const baseUrl = this.getBaseUrl();
        const response = await axios_1.default.get(`${baseUrl}/api/v1/session/${sessionId}`, {
            headers: this.getAuthHeaders()
        });
        if (!response.data.success) {
            throw new Error(response.data.error || 'Failed to get session from cloud');
        }
        return response.data.data;
    }
    async downloadArtifacts(sessionId, sessionData) {
        const artifacts = {};
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
    async applyArtifacts(shadowDir, artifacts) {
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
    shouldApplyToShadow(filePath) {
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
exports.ReclaimCommand = ReclaimCommand;
//# sourceMappingURL=reclaim.js.map