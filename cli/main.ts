#!/usr/bin/env node

import { Command } from 'commander';
import { InitCommand } from './commands/init';
import { StartCommand } from './commands/start';
import { StopCommand } from './commands/stop';
import { StatusCommand } from './commands/status';
import { AnalyzeCommand } from './commands/analyze';
import { OffloadCommand } from './commands/offload';
import { ReclaimCommand } from './commands/reclaim';
import { SyncCommand } from './commands/sync';

const program = new Command();

program
  .name('shadow')
  .description('Shadow workspace overlay system')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize shadow overlay directory')
  .action(async () => {
    const cmd = new InitCommand();
    await cmd.execute();
  });

program
  .command('start')
  .description('Create ephemeral session layer and enter Shadow Mode')
  .action(async () => {
    const cmd = new StartCommand();
    await cmd.execute();
  });

program
  .command('stop')
  .description('Exit Shadow Mode and clear temporary diffs')
  .action(async () => {
    const cmd = new StopCommand();
    await cmd.execute();
  });

program
  .command('status')
  .description('Display current mode and session state')
  .action(async () => {
    const cmd = new StatusCommand();
    await cmd.execute();
  });

program
  .command('analyze')
  .description('Analyze AST diffs and compute impact summary')
  .action(async () => {
    const cmd = new AnalyzeCommand();
    await cmd.execute();
  });

program
  .command('offload')
  .description('Package shadow state and execute in cloud')
  .action(async () => {
    const cmd = new OffloadCommand();
    await cmd.execute();
  });

program
  .command('reclaim')
  .description('Download cloud session results back to shadow')
  .argument('[session-id]', 'Cloud session ID to reclaim')
  .action(async (sessionId) => {
    const cmd = new ReclaimCommand();
    await cmd.execute(sessionId);
  });

program
  .command('sync')
  .description('Sync metadata and timeline to cloud vault')
  .action(async () => {
    const cmd = new SyncCommand();
    await cmd.execute();
  });

program.parse();