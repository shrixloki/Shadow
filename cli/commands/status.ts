import * as fs from 'fs-extra';
import * as path from 'path';
import { ShadowEngine } from '../../core/bindings/node';

export class StatusCommand {
  async execute(): Promise<void> {
    const shadowDir = '.shadow';
    
    try {
      // Check if shadow is initialized
      if (!await fs.pathExists(shadowDir)) {
        console.log('Status: Not initialized');
        console.log('Run "shadow init" to initialize');
        return;
      }

      // Initialize engine
      const engine = new ShadowEngine();
      await engine.initialize(shadowDir);

      // Get status
      const status = await engine.getStatus();
      const diffCount = await engine.getDiffCount();

      console.log(`Status: ${status.isActive ? 'Active' : 'Inactive'}`);
      if (status.isActive) {
        console.log(`Session: ${status.sessionId}`);
        console.log(`Started: ${status.startTime}`);
        console.log(`Diffs: ${diffCount}`);
      }
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }
}