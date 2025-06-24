const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3020;

// Kafka consumer setup
const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'notification-group' });
let consumerConnected = false;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Notification Schema
const NotificationSchema = new mongoose.Schema({
  id: {
    type: String,
    default: uuidv4,
    unique: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['USER_CREATED', 'USER_LOGGED_IN', 'FUND_CREATED', 'INVESTMENT_MADE', 'SYSTEM_ALERT']
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}, {
  timestamps: true
});

// Add indexes for performance
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ type: 1, createdAt: -1 });
NotificationSchema.index({ read: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

const Notification = mongoose.model('Notification', NotificationSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Socket.IO connection handling
const connectedUsers = new Map(); // userId -> socketId mapping

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // User joins their notification room
  socket.on('join', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      connectedUsers.set(userId, socket.id);
      console.log(`User ${userId} joined notification room`);
      
      // Send count of unread notifications
      getUnreadCount(userId).then(count => {
        socket.emit('unread_count', count);
      });
    }
  });

  // User leaves
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Remove from connected users
    for (const [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId);
        break;
      }
    }
  });
});

// Helper function to get unread notification count
async function getUnreadCount(userId) {
  try {
    return await Notification.countDocuments({ userId, read: false });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
}

// Helper function to create notification
async function createNotification(eventData) {
  try {
    let title, message, priority = 'medium';

    switch (eventData.eventType) {
      case 'USER_CREATED':
        title = 'Welcome to Marketplace!';
        message = `Hello ${eventData.firstName}! Your account has been successfully created.`;
        priority = 'high';
        break;
      
      case 'USER_LOGGED_IN':
        title = 'Login Detected';
        message = `You logged into your account at ${new Date(eventData.timestamp).toLocaleString()}.`;
        priority = 'low';
        break;
        
      default:
        title = 'System Notification';
        message = `Event: ${eventData.eventType}`;
        break;
    }

    const notification = new Notification({
      userId: eventData.userId,
      type: eventData.eventType,
      title,
      message,
      data: eventData,
      priority
    });

    const savedNotification = await notification.save();
    console.log('Notification created:', {
      id: savedNotification.id,
      userId: savedNotification.userId,
      type: savedNotification.type,
      title: savedNotification.title
    });

    return savedNotification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

// Helper function to send real-time notification
function sendRealTimeNotification(notification) {
  if (!notification) return;

  // Send to specific user room
  io.to(`user_${notification.userId}`).emit('new_notification', {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    priority: notification.priority,
    createdAt: notification.createdAt,
    data: notification.data
  });

  // Update unread count
  getUnreadCount(notification.userId).then(count => {
    io.to(`user_${notification.userId}`).emit('unread_count', count);
  });

  console.log(`Real-time notification sent to user ${notification.userId}`);
}

// Kafka consumer setup
async function connectConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: 'user-events', fromBeginning: false });
    
    console.log('Kafka consumer connected and subscribed to user-events');
    consumerConnected = true;

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const eventData = JSON.parse(message.value.toString());
          console.log('Received Kafka event:', eventData);

          // Create notification in database
          const notification = await createNotification(eventData);
          
          // Send real-time notification via WebSocket
          if (notification) {
            sendRealTimeNotification(notification);
          }
        } catch (error) {
          console.error('Error processing Kafka message:', error);
        }
      }
    });
  } catch (error) {
    console.error('Error connecting Kafka consumer:', error);
    // Retry connection after delay
    setTimeout(connectConsumer, 5000);
  }
}

connectConsumer();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'notification-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    kafka: consumerConnected ? 'connected' : 'disconnected',
    websocket: 'active',
    connectedClients: io.engine.clientsCount
  });
});

// Get notifications for a user
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
    console.log(`Fetching notifications for user: ${userId}`);
    
    const query = { userId };
    if (unreadOnly === 'true') {
      query.read = false;
    }
    
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .select('-__v');
    
    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ userId, read: false });
    
    console.log(`Found ${notifications.length} notifications for user ${userId}`);
    
    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ 
      message: 'Error fetching notifications',
      error: error.message 
    });
  }
});

// Mark notification as read
app.patch('/api/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    console.log(`Marking notification as read: ${notificationId}`);
    
    const notification = await Notification.findOneAndUpdate(
      { id: notificationId },
      { read: true },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    // Send updated unread count
    const unreadCount = await getUnreadCount(notification.userId);
    io.to(`user_${notification.userId}`).emit('unread_count', unreadCount);
    
    res.json({ 
      message: 'Notification marked as read',
      notification,
      unreadCount
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ 
      message: 'Error updating notification',
      error: error.message 
    });
  }
});

// Mark all notifications as read for a user
app.patch('/api/notifications/:userId/read-all', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`Marking all notifications as read for user: ${userId}`);
    
    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );
    
    // Send updated unread count (should be 0)
    io.to(`user_${userId}`).emit('unread_count', 0);
    
    res.json({ 
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount,
      unreadCount: 0
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ 
      message: 'Error updating notifications',
      error: error.message 
    });
  }
});

// Delete a notification
app.delete('/api/notifications/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    console.log(`Deleting notification: ${notificationId}`);
    
    const notification = await Notification.findOneAndDelete({ id: notificationId });
    
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    // Send updated unread count
    const unreadCount = await getUnreadCount(notification.userId);
    io.to(`user_${notification.userId}`).emit('unread_count', unreadCount);
    
    res.json({ 
      message: 'Notification deleted',
      unreadCount
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ 
      message: 'Error deleting notification',
      error: error.message 
    });
  }
});

// Get notification statistics
app.get('/api/notifications/:userId/stats', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const stats = await Notification.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: {
            $sum: {
              $cond: [{ $eq: ['$read', false] }, 1, 0]
            }
          },
          byType: {
            $push: {
              type: '$type',
              priority: '$priority'
            }
          }
        }
      }
    ]);
    
    const typeStats = await Notification.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          unread: {
            $sum: {
              $cond: [{ $eq: ['$read', false] }, 1, 0]
            }
          }
        }
      }
    ]);
    
    res.json({
      overview: stats[0] || { total: 0, unread: 0 },
      byType: typeStats
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ 
      message: 'Error fetching notification statistics',
      error: error.message 
    });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Closing MongoDB connection');
    await mongoose.connection.close();
    
    console.log('Disconnecting Kafka consumer');
    if (consumerConnected) {
      await consumer.disconnect();
    }
    
    console.log('Closing Socket.IO server');
    io.close();
    
    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Notification service running on port ${PORT}`);
  console.log(`WebSocket server ready for real-time notifications`);
});
