const axios = require('axios');
const { execSync } = require('child_process');

// Service configurations
const services = {
  'auth-service': { port: 3011, healthPath: '/health' },
  'user-service': { port: 3012, healthPath: '/health' },
  'fund-service': { port: 3013, healthPath: '/health' },
  'trading-service': { port: 3014, healthPath: '/health' },
  'settlement-service': { port: 3015, healthPath: '/health' },
  'blockchain-service': { port: 3016, healthPath: '/health' },
  'notification-service': { port: 3020, healthPath: '/health' },
  'nav-oracle': { port: 3021, healthPath: '/health' },
  'forex-oracle': { port: 3022, healthPath: '/health' },
  'custody-oracle': { port: 3023, healthPath: '/health' },
  'market-oracle': { port: 3024, healthPath: '/health' }
};

// Test data
const testUser = {
  email: 'integration-test@example.com',
  password: 'password123',
  firstName: 'Integration',
  lastName: 'Test',
  role: 'user'
};

const testInvestorProfile = {
  userId: '1234567890abcdef', // Placeholder, will be updated after registration
  email: 'integration-test@example.com',
  profile: {
    firstName: 'Integration',
    lastName: 'Test',
    country: 'India',
    phone: '+91-9876543210'
  },
  role: 'investor'
};

const testFund = {
  fundName: 'Integration Test Fund',
  fundType: 'real_estate',
  description: 'Test fund for integration testing',
  targetSize: 10000000,
  minimumInvestment: 100000,
  managementFee: 2.0,
  performanceFee: 20.0,
  lockupPeriod: 12,
  manager: '',
  currency: 'USD'
};

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
};

// Utility functions
function logSuccess(message) {
  console.log(`✅ ${message}`);
  testResults.passed++;
  testResults.total++;
}

function logError(message, error = null) {
  console.log(`❌ ${message}`);
  if (error) {
    console.log(`   Error: ${error.message || error}`);
    testResults.errors.push(`${message}: ${error.message || error}`);
  }
  testResults.failed++;
  testResults.total++;
}

function logInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function logHeader(message) {
  console.log(`\n🔍 ${message.toUpperCase()}`);
  console.log('='.repeat(60));
}

// Wait for service to be ready
async function waitForService(serviceName, maxAttempts = 30) {
  const config = services[serviceName];
  const url = `http://localhost:${config.port}${config.healthPath}`;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 2000 });
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`Service ${serviceName} not ready after ${maxAttempts} attempts`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

// Make HTTP request with error handling
async function makeRequest(method, url, data = null, expectedStatus = [200, 201]) {
  try {
    const config = {
      method,
      url,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    
    if (Array.isArray(expectedStatus) ? expectedStatus.includes(response.status) : response.status === expectedStatus) {
      return { success: true, data: response.data, status: response.status };
    } else {
      return { success: false, status: response.status, data: response.data };
    }
  } catch (error) {
    return { 
      success: false, 
      status: error.response?.status || 500, 
      error: error.message,
      data: error.response?.data 
    };
  }
}

// Test service health
async function testServiceHealth() {
  logHeader('Service Health Check');
  
  for (const [serviceName, config] of Object.entries(services)) {
    try {
      await waitForService(serviceName, 10);
      const response = await makeRequest('GET', `http://localhost:${config.port}${config.healthPath}`);
      
      if (response.success) {
        logSuccess(`${serviceName} is healthy`);
      } else {
        logError(`${serviceName} health check failed (Status: ${response.status})`);
      }
    } catch (error) {
      logError(`${serviceName} is not accessible`, error);
    }
  }
}

// Test authentication flow
async function testAuthenticationFlow() {
  logHeader('Authentication Flow');
  
  try {
    // 1. Register user
    const registerResponse = await makeRequest(
      'POST', 
      'http://localhost:3010/api/register', 
      testUser
    );
    
    if (registerResponse.success) {
      logSuccess('User registration successful');
      testUser.userId = registerResponse.data.userId;
      testInvestorProfile.userId = registerResponse.data.userId;
    } else {
      logError('User registration failed', new Error(`Status: ${registerResponse.status}`));
      return false;
    }
    
    // 2. Login user
    const loginResponse = await makeRequest(
      'POST',
      'http://localhost:3010/api/login',
      { email: testUser.email, password: testUser.password }
    );
    
    if (loginResponse.success) {
      logSuccess('User login successful');
      return true;
    } else {
      logError('User login failed', new Error(`Status: ${loginResponse.status}`));
      return false;
    }
    
  } catch (error) {
    logError('Authentication flow error', error);
    return false;
  }
}

// Test user profile creation
async function testUserProfileFlow() {
  logHeader('User Profile Flow');
  
  try {
    // 1. Create user profile
    const profileResponse = await makeRequest(
      'POST',
      'http://localhost:3012/api/profile',
      testInvestorProfile
    );
    
    if (profileResponse.success) {
      logSuccess('User profile creation successful');
    } else {
      logError('User profile creation failed', new Error(`Status: ${profileResponse.status}`));
      return false;
    }
    
    // 2. Get user profile
    const getProfileResponse = await makeRequest(
      'GET',
      `http://localhost:3012/api/profile/${testInvestorProfile.userId}`
    );
    
    if (getProfileResponse.success) {
      logSuccess('User profile retrieval successful');
    } else {
      logError('User profile retrieval failed', new Error(`Status: ${getProfileResponse.status}`));
    }
    
    // 3. Complete suitability assessment
    const suitabilityData = {
      riskTolerance: 'moderate',
      investmentExperience: 'intermediate',
      incomeLevel: '1Cr_plus',
      netWorth: '5Cr_plus',
      investmentHorizon: 'long_term',
      geography: 'india'
    };
    
    const suitabilityResponse = await makeRequest(
      'POST',
      `http://localhost:3012/api/suitability/${testInvestorProfile.userId}`,
      suitabilityData
    );
    
    if (suitabilityResponse.success) {
      logSuccess('Suitability assessment completed');
      return true;
    } else {
      logError('Suitability assessment failed', new Error(`Status: ${suitabilityResponse.status}`));
      return false;
    }
    
  } catch (error) {
    logError('User profile flow error', error);
    return false;
  }
}

// Test fund management flow
async function testFundManagementFlow() {
  logHeader('Fund Management Flow');
  
  try {
    // 1. Create fund
    testFund.manager = testInvestorProfile.userId;
    
    const fundResponse = await makeRequest(
      'POST',
      'http://localhost:3013/api/funds',
      testFund
    );
    
    if (fundResponse.success) {
      logSuccess('Fund creation successful');
      testFund.fundId = fundResponse.data.fund.fundId;
    } else {
      logError('Fund creation failed', new Error(`Status: ${fundResponse.status}`));
      return false;
    }
    
    // 2. Get fund details
    const getFundResponse = await makeRequest(
      'GET',
      `http://localhost:3013/api/funds/${testFund.fundId}`
    );
    
    if (getFundResponse.success) {
      logSuccess('Fund retrieval successful');
    } else {
      logError('Fund retrieval failed', new Error(`Status: ${getFundResponse.status}`));
    }
    
    // 3. Update fund NAV
    const navUpdateResponse = await makeRequest(
      'POST',
      `http://localhost:3013/api/funds/${testFund.fundId}/nav`,
      { navPerToken: 105.50, totalAssetValue: 10550000 }
    );
    
    if (navUpdateResponse.success) {
      logSuccess('Fund NAV update successful');
      return true;
    } else {
      logError('Fund NAV update failed', new Error(`Status: ${navUpdateResponse.status}`));
      return false;
    }
    
  } catch (error) {
    logError('Fund management flow error', error);
    return false;
  }
}

// Test oracle data flow
async function testOracleDataFlow() {
  logHeader('Oracle Data Flow');
  
  try {
    // 1. Test NAV Oracle
    const navResponse = await makeRequest(
      'GET',
      'http://localhost:3021/api/nav/latest'
    );
    
    if (navResponse.success) {
      logSuccess('NAV Oracle data retrieval successful');
    } else {
      logError('NAV Oracle data retrieval failed', new Error(`Status: ${navResponse.status}`));
    }
    
    // 2. Test Forex Oracle
    const forexResponse = await makeRequest(
      'GET',
      'http://localhost:3022/api/rates/latest'
    );
    
    if (forexResponse.success) {
      logSuccess('Forex Oracle data retrieval successful');
    } else {
      logError('Forex Oracle data retrieval failed', new Error(`Status: ${forexResponse.status}`));
    }
    
    // 3. Test Custody Oracle - register an asset
    const assetData = {
      assetId: 'TEST-ASSET-001',
      assetType: 'real_estate',
      initialValuation: 1000000,
      custodian: 'Test Custodian',
      location: 'Mumbai, India'
    };
    
    const custodyResponse = await makeRequest(
      'POST',
      'http://localhost:3023/api/assets',
      assetData
    );
    
    if (custodyResponse.success) {
      logSuccess('Custody Oracle asset registration successful');
    } else {
      logError('Custody Oracle asset registration failed', new Error(`Status: ${custodyResponse.status}`));
    }
    
    // 4. Test Market Oracle
    const marketResponse = await makeRequest(
      'GET',
      'http://localhost:3024/api/market'
    );
    
    if (marketResponse.success) {
      logSuccess('Market Oracle data retrieval successful');
      return true;
    } else {
      logError('Market Oracle data retrieval failed', new Error(`Status: ${marketResponse.status}`));
      return false;
    }
    
  } catch (error) {
    logError('Oracle data flow error', error);
    return false;
  }
}

// Test trading flow
async function testTradingFlow() {
  logHeader('Trading Flow');
  
  try {
    // 1. Check fund eligibility
    const eligibilityResponse = await makeRequest(
      'GET',
      `http://localhost:3012/api/eligibility/${testInvestorProfile.userId}/${testFund.fundId}`
    );
    
    if (eligibilityResponse.success && eligibilityResponse.data.eligible) {
      logSuccess('Fund eligibility check successful');
    } else {
      logError('Fund eligibility check failed', new Error('User not eligible or check failed'));
      return false;
    }
    
    // 2. Create buy order
    const buyOrderData = {
      fundId: testFund.fundId,
      userId: testInvestorProfile.userId,
      orderType: 'buy',
      quantity: 1000,
      priceType: 'market'
    };
    
    const buyOrderResponse = await makeRequest(
      'POST',
      'http://localhost:3014/api/orders',
      buyOrderData
    );
    
    if (buyOrderResponse.success) {
      logSuccess('Buy order creation successful');
      return true;
    } else {
      logError('Buy order creation failed', new Error(`Status: ${buyOrderResponse.status}`));
      return false;
    }
    
  } catch (error) {
    logError('Trading flow error', error);
    return false;
  }
}

// Test integration data consistency
async function testDataConsistency() {
  logHeader('Data Consistency Check');
  
  try {
    // Check if user data is consistent across services
    const userProfileResponse = await makeRequest(
      'GET',
      `http://localhost:3012/api/profile/${testInvestorProfile.userId}`
    );
    
    const fundResponse = await makeRequest(
      'GET',
      `http://localhost:3013/api/funds/${testFund.fundId}`
    );
    
    if (userProfileResponse.success && fundResponse.success) {
      logSuccess('Data consistency check passed');
      return true;
    } else {
      logError('Data consistency check failed');
      return false;
    }
    
  } catch (error) {
    logError('Data consistency check error', error);
    return false;
  }
}

// Run all tests
async function runComprehensiveTests() {
  console.log('🚀 Starting Comprehensive Integration Tests');
  console.log('============================================\n');
  
  const startTime = Date.now();
  
  try {
    // Step 1: Check service health
    await testServiceHealth();
    
    // Step 2: Test authentication
    const authSuccess = await testAuthenticationFlow();
    if (!authSuccess) {
      logError('Authentication tests failed, stopping execution');
      return;
    }
    
    // Step 3: Test user profile
    const profileSuccess = await testUserProfileFlow();
    if (!profileSuccess) {
      logError('User profile tests failed, stopping execution');
      return;
    }
    
    // Step 4: Test fund management
    const fundSuccess = await testFundManagementFlow();
    if (!fundSuccess) {
      logError('Fund management tests failed, stopping execution');
      return;
    }
    
    // Step 5: Test oracle data
    await testOracleDataFlow();
    
    // Step 6: Test trading flow
    await testTradingFlow();
    
    // Step 7: Test data consistency
    await testDataConsistency();
    
  } catch (error) {
    logError('Comprehensive test error', error);
  }
  
  // Print results
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  logHeader('Test Results Summary');
  console.log(`Total Tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed} ✅`);
  console.log(`Failed: ${testResults.failed} ❌`);
  console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  console.log(`Duration: ${duration} seconds`);
  
  if (testResults.failed > 0) {
    console.log('\n🔍 Failed Tests:');
    testResults.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error}`);
    });
  }
  
  if (testResults.passed === testResults.total) {
    console.log('\n🎉 All tests passed! Integration is successful.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runComprehensiveTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

module.exports = {
  runComprehensiveTests,
  testServiceHealth,
  testAuthenticationFlow,
  testUserProfileFlow,
  testFundManagementFlow,
  testOracleDataFlow,
  testTradingFlow,
  testDataConsistency
};
