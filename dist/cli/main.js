#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const init_1 = require("./commands/init");
const start_1 = require("./commands/start");
const stop_1 = require("./commands/stop");
const status_1 = require("./commands/status");
const analyze_1 = require("./commands/analyze");
const offload_1 = require("./commands/offload");
const reclaim_1 = require("./commands/reclaim");
const sync_1 = require("./commands/sync");
const program = new commander_1.Command();
program
    .name('shadow')
    .description('Shadow workspace overlay system')
    .version('0.1.0');
program
    .command('init')
    .description('Initialize shadow overlay directory')
    .action(async () => {
    const cmd = new init_1.InitCommand();
    await cmd.execute();
});
program
    .command('start')
    .description('Create ephemeral session layer and enter Shadow Mode')
    .action(async () => {
    const cmd = new start_1.StartCommand();
    await cmd.execute();
});
program
    .command('stop')
    .description('Exit Shadow Mode and clear temporary diffs')
    .action(async () => {
    const cmd = new stop_1.StopCommand();
    await cmd.execute();
});
program
    .command('status')
    .description('Display current mode and session state')
    .action(async () => {
    const cmd = new status_1.StatusCommand();
    await cmd.execute();
});
program
    .command('analyze')
    .description('Analyze AST diffs and compute impact summary')
    .action(async () => {
    const cmd = new analyze_1.AnalyzeCommand();
    await cmd.execute();
});
program
    .command('offload')
    .description('Package shadow state and execute in cloud')
    .action(async () => {
    const cmd = new offload_1.OffloadCommand();
    await cmd.execute();
});
program
    .command('reclaim')
    .description('Download cloud session results back to shadow')
    .argument('[session-id]', 'Cloud session ID to reclaim')
    .action(async (sessionId) => {
    const cmd = new reclaim_1.ReclaimCommand();
    await cmd.execute(sessionId);
});
program
    .command('sync')
    .description('Sync metadata and timeline to cloud vault')
    .action(async () => {
    const cmd = new sync_1.SyncCommand();
    await cmd.execute();
});
program.parse();
//# sourceMappingURL=main.js.map