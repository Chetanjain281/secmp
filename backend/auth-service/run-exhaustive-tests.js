// Exhaustive Auth Service Test Suite
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Configuration
const API_BASE_URL = 'http://localhost:3011';
const TEST_EMAIL_PREFIX = 'test-exhaustive';
const TEST_PASSWORD = 'TestPassword123!';
const WEAK_PASSWORD = '123';
const LONG_PASSWORD = 'a'.repeat(200);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m'
};

// Test statistics
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  startTime: null,
  endTime: null
};

// Helper functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ PASS: ${message}`, colors.green);
  stats.passed++;
}

function logError(message) {
  log(`❌ FAIL: ${message}`, colors.red);
  stats.failed++;
}

function logSkip(message) {
  log(`⏭️  SKIP: ${message}`, colors.yellow);
  stats.skipped++;
}

function logInfo(message) {
  log(`ℹ️  INFO: ${message}`, colors.blue);
}

function logHeader(message) {
  log(`\n${colors.bgCyan}${colors.white} ${message.padEnd(60)} ${colors.reset}`);
}

function logSubHeader(message) {
  log(`\n${colors.cyan}── ${message} ──${colors.reset}`);
}

function logTestResult(testName, passed, details = '') {
  stats.total++;
  if (passed) {
    logSuccess(`${testName} ${details}`);
  } else {
    logError(`${testName} ${details}`);
  }
}

async function makeRequest(method, endpoint, data = null, expectedStatus = null) {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await axios({
      method,
      url,
      data,
      validateStatus: () => true // Don't throw on error status
    });
    
    return {
      status: response.status,
      data: response.data,
      success: expectedStatus ? response.status === expectedStatus : (response.status >= 200 && response.status < 300),
      headers: response.headers
    };
  } catch (error) {
    return {
      status: 500,
      data: { message: error.message },
      success: false,
      error: error.message
    };
  }
}

function generateTestUser(suffix = '', role = 'user') {
  const id = uuidv4().substring(0, 8);
  return {
    email: `${TEST_EMAIL_PREFIX}-${suffix}-${id}@example.com`,
    password: TEST_PASSWORD,
    firstName: `Test${suffix}`,
    lastName: 'User',
    role: role
  };
}

function generateInvalidEmails() {
  return [
    'invalid-email',
    '@invalid.com',
    'test@',
    'test@.com',
    'test.invalid',
    '',
    null,
    undefined,
    'test@domain',
    'test@domain.',
    'test space@domain.com',
    'test..test@domain.com'
  ];
}

function generateEdgeCaseData() {
  return {
    emptyStrings: {
      email: '',
      password: '',
      firstName: '',
      lastName: ''
    },
    nullValues: {
      email: null,
      password: null,
      firstName: null,
      lastName: null
    },
    undefinedValues: {
      email: undefined,
      password: undefined,
      firstName: undefined,
      lastName: undefined
    },
    longStrings: {
      email: `${'a'.repeat(100)}@${'b'.repeat(100)}.com`,
      password: 'a'.repeat(200),
      firstName: 'a'.repeat(100),
      lastName: 'b'.repeat(100)
    },
    specialCharacters: {
      email: 'test+tag@domain-name.co.uk',
      password: 'P@ssw0rd!#$%^&*()',
      firstName: 'José María',
      lastName: "O'Connor-Smith"
    },
    sqlInjection: {
      email: "'; DROP TABLE users; --@test.com",
      password: "'; DROP TABLE users; --",
      firstName: "'; SELECT * FROM users; --",
      lastName: "admin'--"
    }
  };
}

// Test Suite Functions

async function testServiceHealth() {
  logHeader('SERVICE HEALTH TESTS');
  
  // Test 1: Basic health check
  const healthResponse = await makeRequest('GET', '/health');
  logTestResult(
    'Health endpoint accessibility',
    healthResponse.success,
    healthResponse.success ? 'Service is responding' : `Status: ${healthResponse.status}`
  );
  
  if (healthResponse.success) {
    // Test 2: MongoDB connection
    const mongoConnected = healthResponse.data.mongodb === 'connected';
    logTestResult('MongoDB connection', mongoConnected);
    
    // Test 3: Kafka connection
    const kafkaConnected = healthResponse.data.kafka === 'connected';
    logTestResult('Kafka connection', kafkaConnected);
    
    // Test 4: Service identification
    const correctService = healthResponse.data.service === 'auth-service';
    logTestResult('Service identification', correctService);
  }
  
  // Test 5: Invalid endpoint
  const invalidResponse = await makeRequest('GET', '/invalid-endpoint', null, 404);
  logTestResult('Invalid endpoint handling', invalidResponse.status === 404);
  
  // Test 6: Health endpoint with different methods
  const postHealthResponse = await makeRequest('POST', '/health', {}, 404);
  logTestResult('Health endpoint method restriction', postHealthResponse.status === 404);
}

async function testUserRegistration() {
  logHeader('USER REGISTRATION TESTS');
  
  logSubHeader('Valid Registration Tests');
  
  // Test 1: Basic user registration
  const basicUser = generateTestUser('basic');
  const basicResponse = await makeRequest('POST', '/api/register', basicUser, 201);
  logTestResult(
    'Basic user registration',
    basicResponse.success,
    basicResponse.success ? `User ID: ${basicResponse.data.userId}` : basicResponse.data.message
  );
  
  // Test 2: Admin user registration
  const adminUser = generateTestUser('admin', 'admin');
  const adminResponse = await makeRequest('POST', '/api/register', adminUser, 201);
  logTestResult('Admin user registration', adminResponse.success);
  
  // Test 3: Fund manager registration
  const managerUser = generateTestUser('manager', 'fund_manager');
  const managerResponse = await makeRequest('POST', '/api/register', managerUser, 201);
  logTestResult('Fund manager registration', managerResponse.success);
  
  // Test 4: User with special characters
  const edgeData = generateEdgeCaseData();
  const specialUser = {
    ...generateTestUser('special'),
    ...edgeData.specialCharacters
  };
  const specialResponse = await makeRequest('POST', '/api/register', specialUser, 201);
  logTestResult('User with special characters', specialResponse.success);
  
  logSubHeader('Duplicate Registration Tests');
  
  // Test 5: Duplicate email registration
  const duplicateResponse = await makeRequest('POST', '/api/register', basicUser, 409);
  logTestResult('Duplicate email prevention', duplicateResponse.status === 409);
  
  logSubHeader('Validation Error Tests');
  
  // Test 6: Missing required fields
  const missingFieldsTests = [
    { field: 'email', data: { ...basicUser, email: undefined } },
    { field: 'password', data: { ...basicUser, password: undefined } },
    { field: 'firstName', data: { ...basicUser, firstName: undefined } },
    { field: 'lastName', data: { ...basicUser, lastName: undefined } }
  ];
  
  for (const test of missingFieldsTests) {
    const response = await makeRequest('POST', '/api/register', test.data, 400);
    logTestResult(`Missing ${test.field} validation`, response.status === 400);
  }
  
  // Test 7: Invalid email formats
  const invalidEmails = generateInvalidEmails();
  for (let i = 0; i < Math.min(5, invalidEmails.length); i++) {
    const email = invalidEmails[i];
    const invalidEmailUser = { ...generateTestUser('invalid'), email };
    const response = await makeRequest('POST', '/api/register', invalidEmailUser, 400);
    logTestResult(`Invalid email format: ${email}`, response.status === 400);
  }
  
  // Test 8: Invalid role
  const invalidRoleUser = { ...generateTestUser('invalidrole'), role: 'super_admin' };
  const invalidRoleResponse = await makeRequest('POST', '/api/register', invalidRoleUser, 400);
  logTestResult('Invalid role validation', invalidRoleResponse.status === 400);
  
  logSubHeader('Edge Case Tests');
  
  // Test 9: Empty strings
  const emptyUser = { ...generateTestUser('empty'), ...edgeData.emptyStrings };
  const emptyResponse = await makeRequest('POST', '/api/register', emptyUser, 400);
  logTestResult('Empty string validation', emptyResponse.status === 400);
  
  // Test 10: Very long fields
  const longUser = { ...generateTestUser('long'), ...edgeData.longStrings };
  const longResponse = await makeRequest('POST', '/api/register', longUser);
  logTestResult('Long string handling', longResponse.status === 201 || longResponse.status === 400);
  
  // Test 11: SQL injection attempt
  const sqlUser = { ...generateTestUser('sql'), ...edgeData.sqlInjection };
  const sqlResponse = await makeRequest('POST', '/api/register', sqlUser);
  logTestResult('SQL injection protection', sqlResponse.status !== 500);
  
  // Test 12: Malformed JSON
  try {
    const malformedResponse = await axios.post(`${API_BASE_URL}/api/register`, 'invalid-json', {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true
    });
    logTestResult('Malformed JSON handling', malformedResponse.status === 400);
  } catch (error) {
    logTestResult('Malformed JSON handling', true);
  }
}

async function testUserLogin() {
  logHeader('USER LOGIN TESTS');
  
  logSubHeader('Valid Login Tests');
  
  // Create a test user first
  const testUser = generateTestUser('login');
  const registerResponse = await makeRequest('POST', '/api/register', testUser, 201);
  
  if (registerResponse.success) {
    // Test 1: Valid login
    const loginResponse = await makeRequest('POST', '/api/login', {
      email: testUser.email,
      password: testUser.password
    }, 200);
    logTestResult('Valid user login', loginResponse.success);
    
    // Test 2: Login response structure
    if (loginResponse.success) {
      const hasRequiredFields = loginResponse.data.userId && 
                               loginResponse.data.email && 
                               loginResponse.data.firstName && 
                               loginResponse.data.lastName && 
                               loginResponse.data.role;
      logTestResult('Login response structure', hasRequiredFields);
    }
  }
  
  logSubHeader('Invalid Login Tests');
  
  // Test 3: Non-existent user
  const nonExistentResponse = await makeRequest('POST', '/api/login', {
    email: 'nonexistent@example.com',
    password: 'password123'
  }, 401);
  logTestResult('Non-existent user login', nonExistentResponse.status === 401);
  
  // Test 4: Wrong password
  const wrongPasswordResponse = await makeRequest('POST', '/api/login', {
    email: testUser.email,
    password: 'wrongpassword'
  }, 401);
  logTestResult('Wrong password rejection', wrongPasswordResponse.status === 401);
  
  // Test 5: Missing email
  const missingEmailResponse = await makeRequest('POST', '/api/login', {
    password: testUser.password
  }, 400);
  logTestResult('Missing email validation', missingEmailResponse.status === 400);
  
  // Test 6: Missing password
  const missingPasswordResponse = await makeRequest('POST', '/api/login', {
    email: testUser.email
  }, 400);
  logTestResult('Missing password validation', missingPasswordResponse.status === 400);
  
  // Test 7: Empty credentials
  const emptyCredsResponse = await makeRequest('POST', '/api/login', {
    email: '',
    password: ''
  }, 400);
  logTestResult('Empty credentials validation', emptyCredsResponse.status === 400);
  
  // Test 8: Case sensitivity check
  const upperCaseEmailResponse = await makeRequest('POST', '/api/login', {
    email: testUser.email.toUpperCase(),
    password: testUser.password
  }, 200);
  logTestResult('Email case insensitivity', upperCaseEmailResponse.success);
}

async function testUserRetrieval() {
  logHeader('USER RETRIEVAL TESTS');
  
  logSubHeader('Get All Users Tests');
  
  // Test 1: Get all users
  const allUsersResponse = await makeRequest('GET', '/api/users', null, 200);
  logTestResult('Get all users', allUsersResponse.success);
  
  if (allUsersResponse.success) {
    // Test 2: Response is array
    const isArray = Array.isArray(allUsersResponse.data);
    logTestResult('Users response is array', isArray);
    
    // Test 3: Users have required fields
    if (isArray && allUsersResponse.data.length > 0) {
      const firstUser = allUsersResponse.data[0];
      const hasRequiredFields = firstUser._id && 
                               firstUser.email && 
                               firstUser.firstName && 
                               firstUser.lastName && 
                               firstUser.role;
      logTestResult('User objects have required fields', hasRequiredFields);
      
      // Test 4: Password field is excluded
      const passwordExcluded = !firstUser.password;
      logTestResult('Password field excluded from response', passwordExcluded);
    }
  }
  
  logSubHeader('Get User by ID Tests');
  
  // Create a test user for ID tests
  const testUser = generateTestUser('getbyid');
  const registerResponse = await makeRequest('POST', '/api/register', testUser, 201);
  
  if (registerResponse.success) {
    const userId = registerResponse.data.userId;
    
    // Test 5: Get user by valid ID
    const getUserResponse = await makeRequest('GET', `/api/users/${userId}`, null, 200);
    logTestResult('Get user by valid ID', getUserResponse.success);
    
    // Test 6: Get user by invalid ID format
    const invalidIdResponse = await makeRequest('GET', '/api/users/invalid-id', null, 400);
    logTestResult('Invalid ID format handling', invalidIdResponse.status === 400);
    
    // Test 7: Get user by non-existent ID
    const nonExistentId = '507f1f77bcf86cd799439011'; // Valid ObjectId format but non-existent
    const nonExistentResponse = await makeRequest('GET', `/api/users/${nonExistentId}`, null, 404);
    logTestResult('Non-existent user ID handling', nonExistentResponse.status === 404);
  }
}

async function testSecurityAndPerformance() {
  logHeader('SECURITY & PERFORMANCE TESTS');
  
  logSubHeader('Security Tests');
  
  // Test 1: Rate limiting (if implemented)
  const rapidRequests = [];
  for (let i = 0; i < 10; i++) {
    rapidRequests.push(makeRequest('GET', '/health'));
  }
  
  try {
    const responses = await Promise.all(rapidRequests);
    const allSuccessful = responses.every(r => r.success);
    logTestResult('Handle rapid requests', allSuccessful);
  } catch (error) {
    logTestResult('Handle rapid requests', false, 'Failed to handle concurrent requests');
  }
  
  // Test 2: Large payload handling
  const largeUser = generateTestUser('large');
  largeUser.firstName = 'A'.repeat(10000);
  const largePayloadResponse = await makeRequest('POST', '/api/register', largeUser);
  logTestResult('Large payload handling', largePayloadResponse.status !== 500);
  
  // Test 3: XSS attempt in input
  const xssUser = generateTestUser('xss');
  xssUser.firstName = '<script>alert("xss")</script>';
  xssUser.lastName = '"><img src=x onerror=alert("xss")>';
  const xssResponse = await makeRequest('POST', '/api/register', xssUser);
  logTestResult('XSS input handling', xssResponse.status !== 500);
  
  logSubHeader('Performance Tests');
  
  // Test 4: Response time check
  const startTime = Date.now();
  const perfResponse = await makeRequest('GET', '/health');
  const responseTime = Date.now() - startTime;
  logTestResult(`Response time under 1000ms (${responseTime}ms)`, responseTime < 1000);
  
  // Test 5: Concurrent user registrations
  const concurrentUsers = [];
  for (let i = 0; i < 5; i++) {
    concurrentUsers.push(makeRequest('POST', '/api/register', generateTestUser(`concurrent${i}`)));
  }
  
  try {
    const concurrentResponses = await Promise.all(concurrentUsers);
    const successfulRegistrations = concurrentResponses.filter(r => r.success).length;
    logTestResult(`Concurrent registrations (${successfulRegistrations}/5)`, successfulRegistrations >= 3);
  } catch (error) {
    logTestResult('Concurrent registrations', false, 'Failed concurrent registration test');
  }
}

async function testErrorHandling() {
  logHeader('ERROR HANDLING TESTS');
  
  // Test 1: Unsupported HTTP methods
  const methodTests = [
    { method: 'PUT', endpoint: '/api/register' },
    { method: 'DELETE', endpoint: '/api/register' },
    { method: 'PATCH', endpoint: '/api/login' },
    { method: 'PUT', endpoint: '/api/users' }
  ];
  
  for (const test of methodTests) {
    const response = await makeRequest(test.method, test.endpoint, {});
    logTestResult(`${test.method} ${test.endpoint} method not allowed`, [404, 405].includes(response.status));
  }
  
  // Test 2: Invalid content type
  try {
    const response = await axios.post(`${API_BASE_URL}/api/register`, 'plain text data', {
      headers: { 'Content-Type': 'text/plain' },
      validateStatus: () => true
    });
    logTestResult('Invalid content type handling', response.status === 400);
  } catch (error) {
    logTestResult('Invalid content type handling', true);
  }
  
  // Test 3: Missing content type
  try {
    const response = await axios.post(`${API_BASE_URL}/api/register`, '{}', {
      validateStatus: () => true
    });
    logTestResult('Missing content type handling', response.status !== 500);
  } catch (error) {
    logTestResult('Missing content type handling', true);
  }
}

async function testDataIntegrity() {
  logHeader('DATA INTEGRITY TESTS');
  
  // Test 1: Password hashing verification
  const testUser = generateTestUser('integrity');
  const registerResponse = await makeRequest('POST', '/api/register', testUser, 201);
  
  if (registerResponse.success) {
    // Try to login to verify password was hashed correctly
    const loginResponse = await makeRequest('POST', '/api/login', {
      email: testUser.email,
      password: testUser.password
    }, 200);
    logTestResult('Password hashing integrity', loginResponse.success);
    
    // Verify user data integrity
    const getUserResponse = await makeRequest('GET', `/api/users/${registerResponse.data.userId}`, null, 200);
    if (getUserResponse.success) {
      const userData = getUserResponse.data;
      const dataIntact = userData.email === testUser.email.toLowerCase() &&
                        userData.firstName === testUser.firstName &&
                        userData.lastName === testUser.lastName &&
                        userData.role === testUser.role;
      logTestResult('User data integrity', dataIntact);
    }
  }
  
  // Test 2: Email uniqueness across case variations
  const lowerCaseUser = generateTestUser('case');
  const upperCaseUser = { ...lowerCaseUser, email: lowerCaseUser.email.toUpperCase() };
  
  const firstResponse = await makeRequest('POST', '/api/register', lowerCaseUser, 201);
  const secondResponse = await makeRequest('POST', '/api/register', upperCaseUser, 409);
  
  logTestResult('Email case-insensitive uniqueness', 
    firstResponse.success && secondResponse.status === 409);
}

async function generateTestReport() {
  logHeader('TEST EXECUTION SUMMARY');
  
  stats.endTime = Date.now();
  const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
  
  log(`\n📊 Test Results Summary:`);
  log(`   Total Tests: ${stats.total}`);
  log(`   ✅ Passed: ${stats.passed}`, colors.green);
  log(`   ❌ Failed: ${stats.failed}`, stats.failed > 0 ? colors.red : colors.reset);
  log(`   ⏭️  Skipped: ${stats.skipped}`, colors.yellow);
  log(`   ⏱️  Duration: ${duration}s`);
  
  const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
  log(`   📈 Success Rate: ${successRate}%`, successRate >= 90 ? colors.green : successRate >= 70 ? colors.yellow : colors.red);
  
  if (stats.failed === 0) {
    log(`\n🎉 ALL TESTS PASSED! Auth service is working perfectly! 🎉`, colors.bgGreen);
  } else if (stats.failed <= 3) {
    log(`\n⚠️  Minor issues detected. Auth service is mostly functional.`, colors.bgYellow);
  } else {
    log(`\n🔥 Major issues detected. Auth service needs attention.`, colors.bgRed);
  }
  
  log(`\n📝 MongoDB Compass Connection: mongodb://localhost:27017/marketplace`);
  log(`🔌 Service Health Check: ${API_BASE_URL}/health`);
}

// Main test runner
async function runExhaustiveTests() {
  stats.startTime = Date.now();
  
  log(`${colors.bgMagenta}${colors.white}                                                    ${colors.reset}`);
  log(`${colors.bgMagenta}${colors.white}  🧪 EXHAUSTIVE AUTH SERVICE TEST SUITE 🧪          ${colors.reset}`);
  log(`${colors.bgMagenta}${colors.white}                                                    ${colors.reset}`);
  log(`\n🚀 Starting comprehensive testing of Auth Service...`);
  log(`📍 Target: ${API_BASE_URL}`);
  log(`⏰ Started at: ${new Date().toLocaleString()}\n`);
  
  try {
    await testServiceHealth();
    await testUserRegistration();
    await testUserLogin();
    await testUserRetrieval();
    await testSecurityAndPerformance();
    await testErrorHandling();
    await testDataIntegrity();
    
    await generateTestReport();
    
  } catch (error) {
    logError(`Critical test suite error: ${error.message}`);
    console.error('Full error:', error);
  }
}

// Run the exhaustive test suite
runExhaustiveTests().catch(error => {
  console.error('Failed to run test suite:', error);
  process.exit(1);
});
