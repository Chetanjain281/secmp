// Test Auth Service functionality
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Configuration
const API_BASE_URL = 'http://localhost:3011';
const TEST_EMAIL_PREFIX = 'test-user';
const TEST_PASSWORD = 'Password123!';

// Test users
const testUsers = {
  regular: {
    email: `${TEST_EMAIL_PREFIX}-regular-${uuidv4().substring(0, 8)}@example.com`,
    password: TEST_PASSWORD,
    firstName: 'Test',
    lastName: 'User',
    role: 'user'
  },
  admin: {
    email: `${TEST_EMAIL_PREFIX}-admin-${uuidv4().substring(0, 8)}@example.com`,
    password: TEST_PASSWORD,
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin'
  },
  fundManager: {
    email: `${TEST_EMAIL_PREFIX}-manager-${uuidv4().substring(0, 8)}@example.com`,
    password: TEST_PASSWORD,
    firstName: 'Fund',
    lastName: 'Manager',
    role: 'fund_manager'
  }
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Helper functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️ ${message}`, colors.blue);
}

function logHeader(message) {
  log(`\n${colors.cyan}======== ${message} ========${colors.reset}`);
}

async function makeRequest(method, endpoint, data = null) {
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
      success: response.status >= 200 && response.status < 300
    };
  } catch (error) {
    return {
      status: 500,
      data: { message: error.message },
      success: false
    };
  }
}

// Test cases
async function testHealthEndpoint() {
  logHeader('Health Check');
  
  const response = await makeRequest('get', '/health');
  
  if (response.success) {
    logSuccess(`Health check passed: ${JSON.stringify(response.data)}`);
  } else {
    logError(`Health check failed: ${JSON.stringify(response.data)}`);
  }
  
  return response.success;
}

async function testRegistration(userType) {
  logHeader(`Registration - ${userType} User`);
  
  const userData = testUsers[userType];
  logInfo(`Registering ${userType} user with email: ${userData.email}`);
  
  const response = await makeRequest('post', '/api/register', userData);
  
  if (response.success) {
    logSuccess('Registration successful');
    logInfo(`User ID: ${response.data.userId}`);
    testUsers[userType].id = response.data.userId;
    return true;
  } else {
    logError(`Registration failed: ${response.data.message}`);
    return false;
  }
}

async function testLogin(userType) {
  logHeader(`Login - ${userType} User`);
  
  const userData = testUsers[userType];
  logInfo(`Logging in as ${userData.email}`);
  
  const response = await makeRequest('post', '/api/login', {
    email: userData.email,
    password: userData.password
  });
  
  if (response.success) {
    logSuccess('Login successful');
    return true;
  } else {
    logError(`Login failed: ${response.data.message}`);
    return false;
  }
}

async function testGetAllUsers() {
  logHeader('Get All Users');
  
  const response = await makeRequest('get', '/api/users');
  
  if (response.success) {
    logSuccess(`Retrieved ${response.data.length} users`);
    logInfo('Users:');
    response.data.forEach(user => {
      log(`- ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}`);
    });
    return true;
  } else {
    logError(`Failed to get users: ${response.data.message}`);
    return false;
  }
}

async function testGetUserById(userType) {
  logHeader(`Get User by ID - ${userType}`);
  
  const userId = testUsers[userType].id;
  if (!userId) {
    logError('No user ID available. Registration probably failed.');
    return false;
  }
  
  logInfo(`Getting user with ID: ${userId}`);
  
  const response = await makeRequest('get', `/api/users/${userId}`);
  
  if (response.success) {
    logSuccess(`Retrieved user: ${response.data.firstName} ${response.data.lastName}`);
    return true;
  } else {
    logError(`Failed to get user: ${response.data.message}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  log('\n🚀 STARTING AUTH SERVICE TESTS 🚀', colors.magenta);
  
  // Test health endpoint
  const healthOk = await testHealthEndpoint();
  if (!healthOk) {
    logError('Health check failed. Make sure the auth service is running.');
    return;
  }
  
  // Test registration
  const regularRegistered = await testRegistration('regular');
  const adminRegistered = await testRegistration('admin');
  const managerRegistered = await testRegistration('fundManager');
  
  // Test login
  if (regularRegistered) await testLogin('regular');
  if (adminRegistered) await testLogin('admin');
  if (managerRegistered) await testLogin('fundManager');
  
  // Test get users
  await testGetAllUsers();
  
  // Test get user by ID
  if (regularRegistered) await testGetUserById('regular');
  
  log('\n🏁 AUTH SERVICE TESTS COMPLETED 🏁', colors.magenta);
}

// Run tests
runTests().catch(error => {
  logError(`Test suite error: ${error.message}`);
});
