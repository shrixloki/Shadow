const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building Shadow by Shrik...');

try {
  // Build TypeScript
  console.log('Compiling TypeScript...');
  execSync('npx tsc', { stdio: 'inherit' });

  // Try to build WASM (optional for development)
  try {
    console.log('Building Rust WASM module...');
    process.chdir('core');
    
    // Run tests first
    try {
      console.log('Running Rust tests...');
      execSync('cargo test', { stdio: 'inherit' });
    } catch (testError) {
      console.warn('Rust tests failed:', testError.message);
    }
    
    // Build WASM
    execSync('wasm-pack build --target nodejs --out-dir bindings/node/pkg', { stdio: 'inherit' });
    process.chdir('..');
    console.log('WASM build successful');
  } catch (wasmError) {
    console.warn('WASM build failed (fallback mode will be used):', wasmError.message);
    process.chdir('..');
  }

  // Make CLI executable
  const cliPath = path.join('dist', 'cli', 'main.js');
  if (fs.existsSync(cliPath)) {
    let content = fs.readFileSync(cliPath, 'utf8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      content = '#!/usr/bin/env node\n' + content;
      fs.writeFileSync(cliPath, content);
    }
    
    // Make executable on Unix systems
    try {
      fs.chmodSync(cliPath, '755');
    } catch (chmodError) {
      // Ignore chmod errors on Windows
    }
  }

  console.log('Build complete!');
  console.log('');
  console.log('Usage:');
  console.log('  node dist/cli/main.js init');
  console.log('  node dist/cli/main.js start');
  console.log('  node dist/cli/main.js stop');
  console.log('  node dist/cli/main.js status');

} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}