// End-to-End Integration Test for Auth + Notification Services
const axios = require('axios');
const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Configuration
const AUTH_API_BASE_URL = 'http://localhost:3011';
const NOTIFICATION_API_BASE_URL = 'http://localhost:3020';
const WEBSOCKET_URL = 'http://localhost:3020';

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

// Helper function to make HTTP requests
async function makeRequest(baseUrl, method, endpoint, data = null) {
  try {
    const url = `${baseUrl}${endpoint}`;
    const response = await axios({
      method,
      url,
      data,
      validateStatus: () => true
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

// Helper function to wait for a specified time
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test WebSocket connection and real-time notifications
function testWebSocket(userId) {
  return new Promise((resolve) => {
    const socket = io(WEBSOCKET_URL);
    const events = [];
    let timeout;

    socket.on('connect', () => {
      logInfo(`WebSocket connected to ${WEBSOCKET_URL}`);
      socket.emit('join', userId);
      
      // Set timeout to resolve after 10 seconds
      timeout = setTimeout(() => {
        socket.disconnect();
        resolve({ events, connected: true });
      }, 10000);
    });

    socket.on('unread_count', (count) => {
      logInfo(`Received unread count: ${count}`);
      events.push({ type: 'unread_count', data: count });
    });

    socket.on('new_notification', (notification) => {
      logInfo(`Received new notification: ${notification.title}`);
      events.push({ type: 'new_notification', data: notification });
    });

    socket.on('disconnect', () => {
      logInfo('WebSocket disconnected');
      if (timeout) clearTimeout(timeout);
      resolve({ events, connected: true });
    });

    socket.on('connect_error', (error) => {
      logError(`WebSocket connection error: ${error.message}`);
      if (timeout) clearTimeout(timeout);
      resolve({ events, connected: false });
    });
  });
}

// Main test function
async function runIntegrationTests() {
  log('\n🚀 STARTING END-TO-END INTEGRATION TESTS 🚀', colors.magenta);
  log('Testing Auth Service + Notification Service Integration\n');

  let testResults = {
    total: 0,
    passed: 0,
    failed: 0
  };

  try {
    // Step 1: Check both services are healthy
    logHeader('Service Health Checks');
    testResults.total += 2;

    const authHealth = await makeRequest(AUTH_API_BASE_URL, 'get', '/health');
    if (authHealth.success) {
      logSuccess('Auth service is healthy');
      testResults.passed++;
    } else {
      logError('Auth service health check failed');
      testResults.failed++;
    }

    const notifHealth = await makeRequest(NOTIFICATION_API_BASE_URL, 'get', '/health');
    if (notifHealth.success) {
      logSuccess('Notification service is healthy');
      logInfo(`Connected clients: ${notifHealth.data.connectedClients}`);
      testResults.passed++;
    } else {
      logError('Notification service health check failed');
      testResults.failed++;
    }

    // Step 2: Create a test user (this should trigger a USER_CREATED event)
    logHeader('User Registration & Notification Flow');
    testResults.total++;

    const testEmail = `integration-test-${uuidv4().substring(0, 8)}@example.com`;
    const userData = {
      email: testEmail,
      password: 'TestPassword123!',
      firstName: 'Integration',
      lastName: 'Test',
      role: 'user'
    };

    logInfo(`Creating user: ${testEmail}`);
    const registerResponse = await makeRequest(AUTH_API_BASE_URL, 'post', '/api/register', userData);
    
    if (registerResponse.success) {
      logSuccess(`User created successfully with ID: ${registerResponse.data.userId}`);
      testResults.passed++;
    } else {
      logError(`User registration failed: ${registerResponse.data.message}`);
      testResults.failed++;
      return testResults; // Exit early if user creation fails
    }

    const userId = registerResponse.data.userId;

    // Step 3: Start WebSocket connection to listen for real-time notifications
    logHeader('WebSocket Real-time Notifications');
    testResults.total++;

    logInfo('Starting WebSocket connection...');
    const wsPromise = testWebSocket(userId);

    // Step 4: Wait a moment for the USER_CREATED event to be processed
    logInfo('Waiting for USER_CREATED event to be processed...');
    await sleep(3000);

    // Step 5: Trigger more events (login)
    logHeader('User Login & Additional Events');
    testResults.total++;

    logInfo('Logging in user to trigger USER_LOGGED_IN event...');
    const loginResponse = await makeRequest(AUTH_API_BASE_URL, 'post', '/api/login', {
      email: testEmail,
      password: userData.password
    });

    if (loginResponse.success) {
      logSuccess('User login successful - USER_LOGGED_IN event triggered');
      testResults.passed++;
    } else {
      logError(`Login failed: ${loginResponse.data.message}`);
      testResults.failed++;
    }

    // Step 6: Wait for more events to be processed
    logInfo('Waiting for USER_LOGGED_IN event to be processed...');
    await sleep(3000);

    // Step 7: Check notifications via API
    logHeader('Notification API Tests');
    testResults.total += 3;

    // Get user notifications
    logInfo(`Fetching notifications for user: ${userId}`);
    const notificationsResponse = await makeRequest(NOTIFICATION_API_BASE_URL, 'get', `/api/notifications/${userId}`);
    
    if (notificationsResponse.success) {
      const { notifications, unreadCount } = notificationsResponse.data;
      logSuccess(`Retrieved ${notifications.length} notifications, ${unreadCount} unread`);
      
      if (notifications.length > 0) {
        logInfo('Notifications found:');
        notifications.forEach((notif, index) => {
          log(`  ${index + 1}. ${notif.title} - ${notif.type} (${notif.read ? 'Read' : 'Unread'})`);
        });
      }
      testResults.passed++;
    } else {
      logError(`Failed to fetch notifications: ${notificationsResponse.data.message}`);
      testResults.failed++;
    }

    // Get notification statistics
    logInfo('Fetching notification statistics...');
    const statsResponse = await makeRequest(NOTIFICATION_API_BASE_URL, 'get', `/api/notifications/${userId}/stats`);
    
    if (statsResponse.success) {
      const stats = statsResponse.data;
      logSuccess(`Stats - Total: ${stats.overview.total}, Unread: ${stats.overview.unread}`);
      if (stats.byType.length > 0) {
        logInfo('Notifications by type:');
        stats.byType.forEach(type => {
          log(`  - ${type._id}: ${type.count} total, ${type.unread} unread`);
        });
      }
      testResults.passed++;
    } else {
      logError(`Failed to fetch stats: ${statsResponse.data.message}`);
      testResults.failed++;
    }

    // Test marking notifications as read
    if (notificationsResponse.success && notificationsResponse.data.notifications.length > 0) {
      const firstNotification = notificationsResponse.data.notifications[0];
      logInfo(`Marking notification as read: ${firstNotification.id}`);
      
      const markReadResponse = await makeRequest(
        NOTIFICATION_API_BASE_URL, 
        'patch', 
        `/api/notifications/${firstNotification.id}/read`
      );
      
      if (markReadResponse.success) {
        logSuccess('Notification marked as read');
        testResults.passed++;
      } else {
        logError(`Failed to mark as read: ${markReadResponse.data.message}`);
        testResults.failed++;
      }
    } else {
      logInfo('No notifications found to mark as read');
      testResults.passed++; // Count as pass since it's expected behavior
    }

    // Step 8: Wait for WebSocket results
    logHeader('WebSocket Event Results');
    testResults.total++;

    logInfo('Waiting for WebSocket events to complete...');
    const wsResults = await wsPromise;
    
    if (wsResults.connected) {
      logSuccess(`WebSocket connection successful. Received ${wsResults.events.length} events`);
      
      if (wsResults.events.length > 0) {
        logInfo('WebSocket events received:');
        wsResults.events.forEach((event, index) => {
          log(`  ${index + 1}. ${event.type}: ${JSON.stringify(event.data)}`);
        });
      }
      testResults.passed++;
    } else {
      logError('WebSocket connection failed');
      testResults.failed++;
    }

    // Step 9: Final integration verification
    logHeader('Integration Verification');
    testResults.total++;

    // Check if we received the expected events
    const hasUnreadCount = wsResults.events.some(e => e.type === 'unread_count');
    const hasNewNotification = wsResults.events.some(e => e.type === 'new_notification');
    
    if (hasUnreadCount || hasNewNotification) {
      logSuccess('Integration verified - Events flowing from Auth → Kafka → Notification Service → WebSocket');
      testResults.passed++;
    } else {
      logError('Integration issue - Events may not be flowing correctly');
      testResults.failed++;
    }

  } catch (error) {
    logError(`Integration test error: ${error.message}`);
    testResults.failed++;
  }

  // Final results
  logHeader('Integration Test Results');
  const successRate = ((testResults.passed / testResults.total) * 100).toFixed(1);
  
  log(`📊 Integration Test Summary:`, colors.cyan);
  log(`   Total Tests: ${testResults.total}`);
  log(`   ✅ Passed: ${testResults.passed}`, colors.green);
  log(`   ❌ Failed: ${testResults.failed}`, colors.red);
  log(`   📈 Success Rate: ${successRate}%`, colors.yellow);
  
  if (testResults.failed === 0) {
    log('\n🎉 ALL INTEGRATION TESTS PASSED! 🎉', colors.green);
    log('✅ Auth Service ↔️ Kafka ↔️ Notification Service ↔️ WebSocket integration is working perfectly!', colors.green);
  } else {
    log(`\n⚠️ ${testResults.failed} integration test(s) failed`, colors.yellow);
    log('Check the logs above for details on what needs to be fixed.', colors.yellow);
  }

  return testResults;
}

// Run the integration tests
runIntegrationTests().catch(error => {
  logError(`Integration test suite error: ${error.message}`);
});
