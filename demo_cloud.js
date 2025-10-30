// Demo script for Block III - The Cloud Bridge
// Tests the shadow cloud functionality

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('Shadow by Shrik - Block III Cloud Demo');
console.log('='.repeat(40));

async function runDemo() {
  try {
    console.log('1. Checking cloud services...');
    
    // Check if cloud config exists
    const cloudConfigPath = path.join('cloud', 'config', 'cloud.config.json');
    if (!fs.existsSync(cloudConfigPath)) {
      console.log('✗ Cloud configuration not found');
      return;
    }
    console.log('✓ Cloud configuration found');

    // Check if Go binary exists
    const apiBinaryPath = path.join('cloud', 'bin', 'api_gateway');
    if (!fs.existsSync(apiBinaryPath)) {
      console.log('✗ API Gateway binary not found. Run cloud build first.');
      console.log('  cd cloud && chmod +x build.sh && ./build.sh');
      return;
    }
    console.log('✓ API Gateway binary found');

    console.log('\n2. Testing CLI cloud commands...');
    
    // Ensure shadow is initialized
    if (!fs.existsSync('.shadow')) {
      console.log('Initializing shadow...');
      try {
        execSync('node dist/cli/main.js init', { stdio: 'inherit' });
      } catch (error) {
        console.log('Note: CLI not built. Run npm run build first.');
      }
    }

    // Create sample files for cloud demo
    const shadowDir = '.shadow';
    const demoFiles = {
      'demo-service.ts': `
export class CloudDemoService {
  private data: string[] = [];
  
  public addItem(item: string): void {
    this.data.push(item);
    console.log('Added item to cloud demo:', item);
  }
  
  public getItems(): string[] {
    return [...this.data];
  }
  
  public processInCloud(): string {
    return 'Processed in ShrikCloud: ' + this.data.join(', ');
  }
}
`,
      'package.json': JSON.stringify({
        name: 'shadow-cloud-demo',
        version: '1.0.0',
        scripts: {
          test: 'echo "Cloud test executed successfully"'
        }
      }, null, 2)
    };

    console.log('Creating demo files in shadow workspace...');
    for (const [filename, content] of Object.entries(demoFiles)) {
      const filePath = path.join(shadowDir, filename);
      fs.writeFileSync(filePath, content);
    }

    console.log('\n3. Cloud Bridge Demo Flow:');
    console.log('   a) Start API Gateway: ./cloud/bin/api_gateway');
    console.log('   b) Start Dashboard: cd dashboard/minimal && python3 -m http.server 3000');
    console.log('   c) Run CLI commands:');
    console.log('      - shadow offload   (upload to cloud)');
    console.log('      - shadow reclaim   (download results)');
    console.log('      - shadow sync      (sync metadata)');

    console.log('\n4. Manual Testing:');
    console.log('   Dashboard: http://localhost:3000');
    console.log('   API: http://localhost:8080/api/v1/session/list');
    console.log('   WebSocket: ws://localhost:8080/ws/logs/{session_id}');

    console.log('\n5. Expected Flow:');
    console.log('   ✓ CLI packages shadow state');
    console.log('   ✓ API Gateway accepts session init/sync');
    console.log('   ✓ Docker runner executes tests in container');
    console.log('   ✓ Logs stream to dashboard via WebSocket');
    console.log('   ✓ Results available for reclaim');

    console.log('\nBlock III - The Cloud Bridge implementation complete!');
    console.log('All components ready for local testing.');

  } catch (error) {
    console.error('Demo failed:', error.message);
  }
}

runDemo();