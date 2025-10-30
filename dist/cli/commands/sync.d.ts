export declare class SyncCommand {
    private cloudConfig;
    private authToken;
    execute(): Promise<void>;
    private loadCloudConfig;
    private generateToken;
    private checkCloudConnectivity;
    private getBaseUrl;
    private getAuthHeaders;
    private gatherLocalMetadata;
    private parseSessionLog;
    private countShadowFiles;
    private countFilesRecursive;
    private syncMetadataToCloud;
    private updateLocalSyncStatus;
    private syncOffline;
}
//# sourceMappingURL=sync.d.ts.map