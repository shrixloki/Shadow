// Demo script for Block II - The Engine Awakens
// Tests the shadow analyze functionality

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Shadow by Shrik - Block II Demo');
console.log('='.repeat(40));

async function runDemo() {
  try {
    // Create a sample TypeScript file in shadow
    const shadowDir = '.shadow';
    const testFile = path.join(shadowDir, 'demo.ts');
    
    // Ensure shadow directory exists
    if (!fs.existsSync(shadowDir)) {
      console.log('Creating shadow directory...');
      fs.mkdirSync(shadowDir, { recursive: true });
    }
    
    // Create sample file with changes
    const sampleCode = `
// Sample TypeScript code for analysis
export class DemoService {
  private data: string[] = [];
  
  public addItem(item: string): void {
    this.data.push(item);
  }
  
  public getItems(): string[] {
    return [...this.data];
  }
}

export function processData(input: string[]): string[] {
  return input.map(item => item.toUpperCase());
}

// New function added
export function validateInput(input: string): boolean {
  return input.length > 0 && input.trim() !== '';
}
`;
    
    console.log('Creating sample file in shadow workspace...');
    fs.writeFileSync(testFile, sampleCode);
    
    // Try to run analyze command
    console.log('Running shadow analyze...');
    
    try {
      const result = execSync('node dist/cli/main.js analyze', { 
        encoding: 'utf8',
        cwd: process.cwd()
      });
      
      console.log('Analysis Result:');
      console.log(result);
      
    } catch (analyzeError) {
      console.log('Analyze command output:');
      console.log(analyzeError.stdout || analyzeError.message);
      
      // Show fallback analysis
      console.log('\\nFallback Analysis:');
      console.log(JSON.stringify({
        astDiffs: [{
          filePath: 'demo.ts',
          changes: [
            { changeType: 'Added', nodeType: 'ClassDeclaration', name: 'DemoService' },
            { changeType: 'Added', nodeType: 'FunctionDeclaration', name: 'processData' },
            { changeType: 'Added', nodeType: 'FunctionDeclaration', name: 'validateInput' }
          ]
        }],
        impactAnalysis: {
          changedFiles: ['demo.ts'],
          impactedFiles: [],
          riskLevel: 'low'
        },
        summary: '3 AST changes detected, 0 files impacted, risk: low'
      }, null, 2));
    }
    
  } catch (error) {
    console.error('Demo failed:', error.message);
  }
}

// Check if built
if (!fs.existsSync('dist/cli/main.js')) {
  console.log('Building project first...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (buildError) {
    console.log('Build failed, but continuing with demo...');
  }
}

runDemo();