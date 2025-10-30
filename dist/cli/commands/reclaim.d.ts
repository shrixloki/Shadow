export declare class ReclaimCommand {
    private cloudConfig;
    private authToken;
    execute(sessionId?: string): Promise<void>;
    private loadCloudConfig;
    private checkCloudConnectivity;
    private getBaseUrl;
    private getAuthHeaders;
    private getLatestSessionId;
    private getSessionFromCloud;
    private downloadArtifacts;
    private applyArtifacts;
    private shouldApplyToShadow;
}
//# sourceMappingURL=reclaim.d.ts.map