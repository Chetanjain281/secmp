const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Kafka } = require('kafkajs');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

// Kafka setup
const kafka = new Kafka({
  clientId: 'auth-service-tester',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const consumer = kafka.consumer({ groupId: 'auth-test-group' });
const producerConnected = false;

async function runTest() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB successfully');

    // Define User schema
    const UserSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true },
      password: { type: String, required: true },
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      role: { type: String, enum: ['user', 'admin', 'fund_manager'], default: 'user' },
      createdAt: { type: Date, default: Date.now }
    });
    UserSchema.set('timestamps', true);
    
    // Create or get User model
    const User = mongoose.models.User || mongoose.model('User', UserSchema);

    // Connect to Kafka and subscribe to user-events topic
    console.log('Connecting to Kafka consumer...');
    await consumer.connect();
    await consumer.subscribe({ topic: 'user-events', fromBeginning: false });
    console.log('Connected to Kafka and subscribed to user-events');

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const eventData = JSON.parse(message.value.toString());
        console.log('Received event:', eventData);
      }
    });

    // Clean up and create test user
    console.log('Clearing test users...');
    await User.deleteMany({ email: 'test@example.com' });
    
    // Create a test user
    const hashedPassword = await bcrypt.hash('password123', 10);
    const testUser = new User({
      email: 'test@example.com',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'user'
    });
    
    await testUser.save();
    console.log('Test user created:', testUser);
    
    console.log('\nAuth service is ready for testing!');
    console.log('You can now use MongoDB Compass to connect to your database at:', MONGODB_URI);
    console.log('\nTest API endpoints with:');
    console.log('1. Register: POST http://localhost:3010/api/register');
    console.log('   Body: { "email": "newuser@example.com", "password": "password", "firstName": "New", "lastName": "User" }');
    console.log('2. Login: POST http://localhost:3010/api/login');
    console.log('   Body: { "email": "test@example.com", "password": "password123" }');
    console.log('3. Get Users: GET http://localhost:3010/api/users');
    console.log('4. Health Check: GET http://localhost:3010/health');
    
    // Keep the script running to continue consuming Kafka messages
    console.log('\nListening for Kafka messages... (Ctrl+C to exit)');
  } catch (error) {
    console.error('Test failed:', error);
    await mongoose.connection.close();
    await consumer.disconnect();
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  try {
    await mongoose.connection.close();
    await consumer.disconnect();
    console.log('Clean shutdown completed');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

runTest();
