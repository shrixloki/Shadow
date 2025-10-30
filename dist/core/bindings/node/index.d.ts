interface SessionStatus {
    isActive: boolean;
    sessionId?: string;
    startTime?: string;
}
export declare class ShadowEngine {
    private wasmEngine?;
    private wasmModule?;
    constructor();
    initialize(shadowDir: string): Promise<void>;
    startSession(): Promise<string>;
    stopSession(): Promise<void>;
    getStatus(): Promise<SessionStatus>;
    getDiffCount(): Promise<number>;
    computeAstDiffs(fileChanges: Array<[string, string, string]>): Promise<any[]>;
    analyzeImpact(changedFiles: string[]): Promise<any>;
    buildDependencyGraph(workspaceRoot: string): Promise<void>;
    private fallbackSession;
    private initializeFallback;
    private startSessionFallback;
    private stopSessionFallback;
    private getStatusFallback;
    private getDiffCountFallback;
    private computeAstDiffsFallback;
    private analyzeImpactFallback;
    private buildDependencyGraphFallback;
}
export {};
//# sourceMappingURL=index.d.ts.map