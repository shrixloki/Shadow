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
exports.SyncCommand = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
class SyncCommand {
    constructor() {
        this.cloudConfig = null;
        this.authToken = '';
    }
    async execute() {
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
            const result = {
                success: true,
                synced_sessions: syncedSessions,
                metadata_count: Object.keys(localMetadata).length,
                message: 'Metadata synced to cloud vault'
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
        // Load auth token
        const tokenPath = path.join('.shadow', 'cloud.token');
        if (await fs.pathExists(tokenPath)) {
            this.authToken = await fs.readFile(tokenPath, 'utf8');
        }
        else {
            // Generate token for sync
            this.authToken = this.generateToken(32);
            await fs.writeFile(tokenPath, this.authToken);
        }
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
    async gatherLocalMetadata(shadowDir) {
        const metadata = {};
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
        }
        catch (error) {
            metadata.file_stats = { error: 'Could not count files' };
        }
        return metadata;
    }
    parseSessionLog(logContent) {
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
    async countShadowFiles(shadowDir) {
        const stats = {
            total_files: 0,
            by_extension: {},
            total_size: 0
        };
        await this.countFilesRecursive(shadowDir, shadowDir, stats);
        return stats;
    }
    async countFilesRecursive(dirPath, basePath, stats) {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && entry.name !== 'sessions' && entry.name !== 'diffs') {
                    await this.countFilesRecursive(fullPath, basePath, stats);
                }
                else if (entry.isFile()) {
                    stats.total_files++;
                    const ext = path.extname(entry.name).toLowerCase() || 'no_extension';
                    stats.by_extension[ext] = (stats.by_extension[ext] || 0) + 1;
                    try {
                        const fileStat = await fs.stat(fullPath);
                        stats.total_size += fileStat.size;
                    }
                    catch (error) {
                        // Skip files we can't stat
                    }
                }
            }
        }
        catch (error) {
            // Skip directories we can't read
        }
    }
    async syncMetadataToCloud(metadata) {
        const baseUrl = this.getBaseUrl();
        const syncedSessions = [];
        // Create a metadata session
        const sessionResponse = await axios_1.default.post(`${baseUrl}/api/v1/session/init`, {
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
        const syncResponse = await axios_1.default.post(`${baseUrl}/api/v1/session/sync`, {
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
    async updateLocalSyncStatus(shadowDir, syncedSessions) {
        const syncStatusPath = path.join(shadowDir, 'sync_status.json');
        const syncStatus = {
            last_sync: new Date().toISOString(),
            synced_sessions: syncedSessions,
            sync_count: syncedSessions.length
        };
        await fs.writeFile(syncStatusPath, JSON.stringify(syncStatus, null, 2));
    }
    async syncOffline() {
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
exports.SyncCommand = SyncCommand;
//# sourceMappingURL=sync.js.map