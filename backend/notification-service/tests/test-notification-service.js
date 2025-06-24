// Test Notification Service functionality
const axios = require('axios');
const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Configuration
const API_BASE_URL = 'http://localhost:3020';
const SOCKET_URL = 'http://localhost:3020';
const AUTH_API_URL = 'http://localhost:3011/api';

// Test user for notifications
const testUser = {
  email: `notification-test-${uuidv4().substring(0, 8)}@example.com`,
  password: 'TestPassword123!',
  firstName: 'Notification',
  lastName: 'Tester',
  role: 'user'
};

let testUserId = null;

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
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
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
    return true;
  } else {
    logError(`Health check failed: ${JSON.stringify(response.data)}`);
    return false;
  }
}

async function createTestUser() {
  logHeader('Creating Test User for Notifications');
  
  logInfo(`Creating test user: ${testUser.email}`);
  
  const response = await makeRequest('post', `${AUTH_API_URL}/register`, testUser);
  
  if (response.success) {
    testUserId = response.data.userId;
    logSuccess(`Test user created with ID: ${testUserId}`);
    return true;
  } else {
    logError(`Failed to create test user: ${response.data.message}`);
    return false;
  }
}

async function triggerUserLogin() {
  logHeader('Triggering User Login Event');
  
  logInfo(`Logging in test user to trigger Kafka event`);
  
  const response = await makeRequest('post', `${AUTH_API_URL}/login`, {
    email: testUser.email,
    password: testUser.password
  });
  
  if (response.success) {
    logSuccess('User login successful - Kafka event should be triggered');
    return true;
  } else {
    logError(`Login failed: ${response.data.message}`);
    return false;
  }
}

async function testGetNotifications() {
  logHeader('Get User Notifications');
  
  // Wait a bit for Kafka events to be processed
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  logInfo(`Fetching notifications for user: ${testUserId}`);
  
  const response = await makeRequest('get', `/api/notifications/${testUserId}`);
  
  if (response.success) {
    const { notifications, unreadCount } = response.data;
    logSuccess(`Retrieved ${notifications.length} notifications, ${unreadCount} unread`);
    
    if (notifications.length > 0) {
      logInfo('Recent notifications:');
      notifications.slice(0, 3).forEach((notif, index) => {
        log(`  ${index + 1}. ${notif.title} - ${notif.message} (${notif.type})`);
      });
    }
    
    return { success: true, notifications, unreadCount };
  } else {
    logError(`Failed to get notifications: ${response.data.message}`);
    return { success: false };
  }
}

async function testMarkNotificationAsRead() {
  logHeader('Mark Notification as Read');
  
  // First get notifications to find one to mark as read
  const notifResponse = await makeRequest('get', `/api/notifications/${testUserId}?unreadOnly=true`);
  
  if (!notifResponse.success || notifResponse.data.notifications.length === 0) {
    logInfo('No unread notifications found to mark as read');
    return true;
  }
  
  const notification = notifResponse.data.notifications[0];
  logInfo(`Marking notification as read: ${notification.title}`);
  
  const response = await makeRequest('patch', `/api/notifications/${notification.id}/read`);
  
  if (response.success) {
    logSuccess(`Notification marked as read. New unread count: ${response.data.unreadCount}`);
    return true;
  } else {
    logError(`Failed to mark notification as read: ${response.data.message}`);
    return false;
  }
}

async function testMarkAllNotificationsAsRead() {
  logHeader('Mark All Notifications as Read');
  
  logInfo(`Marking all notifications as read for user: ${testUserId}`);
  
  const response = await makeRequest('patch', `/api/notifications/${testUserId}/read-all`);
  
  if (response.success) {
    logSuccess(`All notifications marked as read. Modified: ${response.data.modifiedCount}`);
    return true;
  } else {
    logError(`Failed to mark all notifications as read: ${response.data.message}`);
    return false;
  }
}

async function testNotificationStats() {
  logHeader('Get Notification Statistics');
  
  logInfo(`Fetching notification stats for user: ${testUserId}`);
  
  const response = await makeRequest('get', `/api/notifications/${testUserId}/stats`);
  
  if (response.success) {
    const { overview, byType } = response.data;
    logSuccess(`Stats - Total: ${overview.total}, Unread: ${overview.unread}`);
    
    if (byType.length > 0) {
      logInfo('Notifications by type:');
      byType.forEach(type => {
        log(`  ${type._id}: ${type.count} total, ${type.unread} unread`);
      });
    }
    
    return true;
  } else {
    logError(`Failed to get notification stats: ${response.data.message}`);
    return false;
  }
}

async function testWebSocketConnection() {
  logHeader('WebSocket Real-time Notifications');
  
  return new Promise((resolve) => {
    const socket = io(SOCKET_URL);
    let eventsReceived = 0;
    const timeout = setTimeout(() => {
      socket.disconnect();
      if (eventsReceived > 0) {
        logSuccess(`WebSocket test completed. Received ${eventsReceived} events`);
        resolve(true);
      } else {
        logError('WebSocket test timed out - no events received');
        resolve(false);
      }
    }, 5000);
    
    socket.on('connect', () => {
      logInfo('WebSocket connected');
      socket.emit('join', testUserId);
    });
    
    socket.on('unread_count', (count) => {
      logInfo(`Received unread count: ${count}`);
      eventsReceived++;
    });
    
    socket.on('new_notification', (notification) => {
      logSuccess(`Received real-time notification: ${notification.title}`);
      eventsReceived++;
    });
    
    socket.on('disconnect', () => {
      logInfo('WebSocket disconnected');
    });
    
    socket.on('connect_error', (error) => {
      logError(`WebSocket connection error: ${error.message}`);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function testDeleteNotification() {
  logHeader('Delete Notification');
  
  // First get notifications to find one to delete
  const notifResponse = await makeRequest('get', `/api/notifications/${testUserId}`);
  
  if (!notifResponse.success || notifResponse.data.notifications.length === 0) {
    logInfo('No notifications found to delete');
    return true;
  }
  
  const notification = notifResponse.data.notifications[0];
  logInfo(`Deleting notification: ${notification.title}`);
  
  const response = await makeRequest('delete', `/api/notifications/${notification.id}`);
  
  if (response.success) {
    logSuccess(`Notification deleted. New unread count: ${response.data.unreadCount}`);
    return true;
  } else {
    logError(`Failed to delete notification: ${response.data.message}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  log('\n🚀 STARTING NOTIFICATION SERVICE TESTS 🚀', colors.magenta);
  
  let passed = 0;
  let total = 0;
  
  // Test health endpoint
  total++;
  if (await testHealthEndpoint()) passed++;
  
  // Create test user for notifications
  total++;
  if (await createTestUser()) {
    passed++;
    
    // Test WebSocket connection
    total++;
    if (await testWebSocketConnection()) passed++;
    
    // Trigger events for notifications
    total++;
    if (await triggerUserLogin()) passed++;
    
    // Test notification retrieval
    total++;
    const notifResult = await testGetNotifications();
    if (notifResult.success) passed++;
    
    // Test notification stats
    total++;
    if (await testNotificationStats()) passed++;
    
    // Test mark as read
    total++;
    if (await testMarkNotificationAsRead()) passed++;
    
    // Test mark all as read
    total++;
    if (await testMarkAllNotificationsAsRead()) passed++;
    
    // Test delete notification
    total++;
    if (await testDeleteNotification()) passed++;
  }
  
  // Test summary
  log('\n🏁 NOTIFICATION SERVICE TESTS COMPLETED 🏁', colors.magenta);
  log(`📊 Results: ${passed}/${total} tests passed (${((passed/total)*100).toFixed(1)}%)`, 
      passed === total ? colors.green : colors.yellow);
  
  if (passed === total) {
    log('🎉 All tests passed! Notification service is working correctly! 🎉', colors.green);
  } else {
    log('⚠️ Some tests failed. Check the logs above for details.', colors.yellow);
  }
}

// Run tests
runTests().catch(error => {
  logError(`Test suite error: ${error.message}`);
});
