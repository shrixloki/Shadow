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
exports.OffloadCommand = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const node_1 = require("../../core/bindings/node");
class OffloadCommand {
    constructor() {
        this.cloudConfig = null;
        this.authToken = '';
    }
    async execute() {
        const shadowDir = '.shadow';
        const sessionLogPath = path.join(shadowDir, 'session.log');
        try {
            // Check if shadow is initialized and active
            if (!await fs.pathExists(shadowDir)) {
                console.log('Error: Shadow not initialized. Run "shadow init" first.');
                process.exit(1);
            }
            const engine = new node_1.ShadowEngine();
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
            const result = {
                sessionId,
                status: 'completed',
                executionResult
            };
            console.log(JSON.stringify(result, null, 2));
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
        // Generate or load auth token
        this.authToken = await this.getAuthToken();
    }
    async getAuthToken() {
        const tokenPath = path.join('.shadow', 'cloud.token');
        try {
            if (await fs.pathExists(tokenPath)) {
                return await fs.readFile(tokenPath, 'utf8');
            }
        }
        catch (error) {
            // Generate new token if file doesn't exist or is corrupted
        }
        // Generate new token
        const token = this.generateToken(32);
        await fs.writeFile(tokenPath, token);
        return token;
    }
    generateToken(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
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
    async packageShadowState(shadowDir) {
        const state = {};
        try {
            // Scan shadow directory for files
            await this.scanShadowDirectory(shadowDir, shadowDir, state);
        }
        catch (error) {
            // If no files in shadow, return empty state
        }
        return state;
    }
    async scanShadowDirectory(dirPath, basePath, state) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
                await this.scanShadowDirectory(fullPath, basePath, state);
            }
            else if (entry.isFile() && this.isSupportedFile(entry.name)) {
                const content = await fs.readFile(fullPath, 'utf8');
                const relativePath = path.relative(basePath, fullPath);
                state[relativePath] = content;
            }
        }
    }
    isSupportedFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ['.ts', '.js', '.tsx', '.jsx', '.json', '.md'].includes(ext);
    }
    async initializeCloudSession(localSessionId) {
        const baseUrl = this.getBaseUrl();
        const response = await axios_1.default.post(`${baseUrl}/api/v1/session/init`, {
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
    async syncStateToCloud(sessionId, state) {
        const baseUrl = this.getBaseUrl();
        const response = await axios_1.default.post(`${baseUrl}/api/v1/session/sync`, {
            session_id: sessionId,
            snapshot: state
        }, {
            headers: this.getAuthHeaders()
        });
        if (!response.data.success) {
            throw new Error(response.data.error || 'Failed to sync state to cloud');
        }
    }
    async executeInCloud(sessionId) {
        const baseUrl = this.getBaseUrl();
        // Start execution
        const executeResponse = await axios_1.default.post(`${baseUrl}/api/v1/session/execute`, {
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
    async waitForExecution(sessionId) {
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
exports.OffloadCommand = OffloadCommand;
//# sourceMappingURL=offload.js.map