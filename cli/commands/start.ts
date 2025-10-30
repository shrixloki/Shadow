import * as fs from 'fs-extra';
import * as path from 'path';
import { ShadowEngine } from '../../core/bindings/node';

export class StartCommand {
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
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }
}