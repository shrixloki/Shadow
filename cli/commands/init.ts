import * as fs from 'fs-extra';
import * as path from 'path';
import { ShadowEngine } from '../../core/bindings/node';

export class InitCommand {
  async execute(): Promise<void> {
    const shadowDir = '.shadow';
    const configPath = path.join(process.cwd(), 'config', 'shadow.config.json');
    
    try {
      // Check if config exists
      if (!await fs.pathExists(configPath)) {
        console.log('Error: shadow.config.json not found. Run from project root.');
        process.exit(1);
      }

      // Create shadow directory structure
      await fs.ensureDir(shadowDir);
      await fs.ensureDir(path.join(shadowDir, 'sessions'));
      await fs.ensureDir(path.join(shadowDir, 'diffs'));
      
      // Initialize session log
      const sessionLogPath = path.join(shadowDir, 'session.log');
      if (!await fs.pathExists(sessionLogPath)) {
        await fs.writeFile(sessionLogPath, '');
      }

      // Initialize engine
      const engine = new ShadowEngine();
      await engine.initialize(shadowDir);

      // Log initialization
      const timestamp = new Date().toISOString();
      await fs.appendFile(sessionLogPath, `${timestamp} - Shadow initialized\n`);

      console.log('Shadow overlay initialized');
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }
}