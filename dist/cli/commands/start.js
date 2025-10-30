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
exports.StartCommand = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const node_1 = require("../../core/bindings/node");
class StartCommand {
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
            // Check if already in shadow mode
            const status = await engine.getStatus();
            if (status.isActive) {
                console.log('Already in Shadow Mode');
                return;
            }
            // Start shadow session
            const sessionId = await engine.startSession();
            // Log session start
            const timestamp = new Date().toISOString();
            await fs.appendFile(sessionLogPath, `${timestamp} - Session started: ${sessionId}\n`);
            console.log('Shadow Mode activated');
            console.log(`Session: ${sessionId}`);
        }
        catch (error) {
            console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            process.exit(1);
        }
    }
}
exports.StartCommand = StartCommand;
//# sourceMappingURL=start.js.map