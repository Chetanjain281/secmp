const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Starting User Service Comprehensive Test Suite');
console.log('=' .repeat(60));

// Change to user service directory
process.chdir(__dirname);

// Test configurations
const testConfigs = [
  {
    name: 'Unit Tests',
    command: 'npm test',
    description: 'Core functionality and API endpoint tests'
  },
  {
    name: 'Integration Tests',
    command: 'node run-integration-tests.js',
    description: 'Cross-service integration and end-to-end flows'
  }
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const results = [];

for (const config of testConfigs) {
  console.log(`\n📋 Running ${config.name}...`);
  console.log(`📝 ${config.description}`);
  console.log('-'.repeat(40));
  
  try {
    const startTime = Date.now();
    const output = execSync(config.command, { 
      encoding: 'utf8',
      timeout: 120000 // 2 minutes timeout
    });
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    // Parse Jest output to get test counts
    const testMatch = output.match(/Tests:\s+(\d+)\s+passed/);
    const testsCount = testMatch ? parseInt(testMatch[1]) : 0;
    
    console.log(`✅ ${config.name} completed successfully in ${duration.toFixed(2)}s`);
    console.log(`📊 Tests passed: ${testsCount}`);
    
    totalTests += testsCount;
    passedTests += testsCount;
    
    results.push({
      name: config.name,
      status: 'PASSED',
      testsCount,
      duration: duration.toFixed(2),
      output: output.split('\n').slice(-10).join('\n') // Last 10 lines
    });
    
  } catch (error) {
    console.log(`❌ ${config.name} failed`);
    console.log(`Error: ${error.message}`);
    
    // Try to extract test counts from error output
    const errorOutput = error.stdout || error.message;
    const failedMatch = errorOutput.match(/Tests:\s+(\d+)\s+failed/);
    const passedMatch = errorOutput.match(/Tests:\s+(\d+)\s+passed/);
    
    const failed = failedMatch ? parseInt(failedMatch[1]) : 1;
    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    
    totalTests += (failed + passed);
    passedTests += passed;
    failedTests += failed;
    
    results.push({
      name: config.name,
      status: 'FAILED',
      testsCount: failed + passed,
      failed,
      passed,
      error: error.message,
      output: errorOutput.split('\n').slice(-15).join('\n') // Last 15 lines
    });
  }
}

// Print comprehensive summary
console.log('\n' + '='.repeat(60));
console.log('🏆 USER SERVICE TEST SUMMARY');
console.log('='.repeat(60));

console.log(`\n📊 Overall Statistics:`);
console.log(`   Total Tests: ${totalTests}`);
console.log(`   Passed: ${passedTests} ✅`);
console.log(`   Failed: ${failedTests} ❌`);
console.log(`   Success Rate: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);

console.log(`\n📋 Detailed Results:`);
results.forEach((result, index) => {
  console.log(`\n${index + 1}. ${result.name}: ${result.status}`);
  if (result.status === 'PASSED') {
    console.log(`   ✅ ${result.testsCount} tests passed in ${result.duration}s`);
  } else {
    console.log(`   ❌ ${result.failed || 0} failed, ${result.passed || 0} passed`);
    if (result.error) {
      console.log(`   Error: ${result.error.substring(0, 100)}...`);
    }
  }
});

// Service health check
console.log(`\n🔍 Service Health Check:`);
try {
  // Use PowerShell-compatible curl command
  const healthOutput = execSync('powershell -Command "try { (Invoke-RestMethod -Uri http://localhost:3012/health).status } catch { \'Service not running\' }"', { 
    encoding: 'utf8',
    timeout: 10000
  });
  
  if (healthOutput.trim() === 'ok') {
    console.log('   ✅ User service is running and healthy');
  } else {
    console.log('   ⚠️  User service is not running');
    console.log('   💡 Start with: npm start');
  }
} catch (error) {
  console.log('   ⚠️  Could not check service health');
  console.log('   💡 Start the service with: npm start');
}

// Recommendations
console.log(`\n💡 Next Steps:`);
if (failedTests > 0) {
  console.log('   🔧 Fix failing tests before proceeding');
  console.log('   📝 Check detailed error messages above');
  console.log('   🚀 Rerun tests with: npm test');
} else {
  console.log('   ✅ All tests passing - User Service is ready!');
  console.log('   🚀 Ready to proceed with Fund Service implementation');
  console.log('   📊 Integration with Auth and Notification services verified');
}

console.log(`\n🔗 Available Commands:`);
console.log('   npm start          - Start the user service');
console.log('   npm test          - Run unit tests');
console.log('   npm run dev       - Start in development mode');
console.log('   npm run test:watch - Run tests in watch mode');

console.log('\n' + '='.repeat(60));

// Exit with appropriate code
process.exit(failedTests > 0 ? 1 : 0);
