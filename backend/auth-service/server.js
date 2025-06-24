const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3011;

// Kafka producer setup
const kafka = new Kafka({
  clientId: 'auth-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
let producerConnected = false;

// Connect Kafka producer
async function connectProducer() {
  try {
    await producer.connect();
    console.log('Kafka producer connected');
    producerConnected = true;
  } catch (error) {
    console.error('Error connecting to Kafka:', error);
    // Retry connection after delay
    setTimeout(connectProducer, 5000);
  }
}

connectProducer();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// User Schema
const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'fund_manager'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Add timestamps
UserSchema.set('timestamps', true);

const User = mongoose.model('User', UserSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    kafka: producerConnected ? 'connected' : 'disconnected'
  });
});

// Publish event to Kafka
async function publishEvent(topic, event) {
  if (!producerConnected) {
    console.warn('Kafka producer not connected, skipping message');
    return;
  }
  
  try {
    await producer.send({
      topic,
      messages: [
        { 
          key: event.userId || uuidv4(), 
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Event published to ${topic}:`, event);
    return true;
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
    throw error; // Propagate the error to be caught by the caller
  }
}

// User registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    console.log('Registration request received:', req.body);
    const { email, password, firstName, lastName, role = 'user' } = req.body;
    
    // Validation
    if (!email || !password || !firstName || !lastName) {
      const missingFields = [];
      if (!email) missingFields.push('email');
      if (!password) missingFields.push('password');
      if (!firstName) missingFields.push('firstName');
      if (!lastName) missingFields.push('lastName');
      
      console.log('Missing required fields:', missingFields);
      return res.status(400).json({ 
        message: 'All fields are required',
        missingFields
      });
    }
    
    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Invalid email format:', email);
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('User already exists:', email);
      return res.status(409).json({ 
        message: 'User already exists',
        email
      });
    }
    
    // Validate role
    const validRoles = ['user', 'admin', 'fund_manager'];
    if (role && !validRoles.includes(role)) {
      console.log('Invalid role:', role);
      return res.status(400).json({ 
        message: 'Invalid role',
        validRoles,
        providedRole: role
      });
    }
    
    console.log('Creating user with role:', role);
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user object
    const user = new User({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role
    });
    
    try {
      // Save user to database
      const savedUser = await user.save();
      
      console.log('User saved successfully:', {
        id: savedUser._id,
        email: savedUser.email,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        role: savedUser.role
      });
      
      // Kafka event (don't fail registration if this fails)
      try {
        await publishEvent('user-events', {
          eventType: 'USER_CREATED',
          userId: savedUser._id.toString(),
          email: savedUser.email,
          firstName: savedUser.firstName,
          lastName: savedUser.lastName,
          role: savedUser.role,
          timestamp: new Date().toISOString()
        });
        console.log('Kafka event published successfully');
      } catch (kafkaError) {
        console.error('Kafka event failed (non-critical):', kafkaError);
      }
      
      // Success response
      res.status(201).json({
        message: 'User registered successfully',
        userId: savedUser._id,
        email: savedUser.email,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        role: savedUser.role
      });
    } catch (saveError) {
      console.error('Error saving user to database:', saveError);
      if (saveError.name === 'ValidationError') {
        // Handle Mongoose validation errors
        const validationErrors = {};
        for (const field in saveError.errors) {
          validationErrors[field] = saveError.errors[field].message;
        }
        return res.status(400).json({
          message: 'Validation error',
          errors: validationErrors
        });
      } else {
        throw saveError; // Re-throw for the outer catch
      }
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      message: 'Registration failed',
      error: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined    });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  try {
    console.log('Login request received:', { email: req.body.email });
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      const missingFields = [];
      if (!email) missingFields.push('email');
      if (!password) missingFields.push('password');
      
      console.log('Login validation failed - missing fields:', missingFields);
      return res.status(400).json({ 
        message: 'Email and password are required',
        missingFields
      });
    }
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log('Login failed - user not found:', email);
      return res.status(401).json({ 
        message: 'Invalid credentials',
        details: 'User not found'
      });
    }
    
    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Login failed - password mismatch for user:', email);
      return res.status(401).json({ 
        message: 'Invalid credentials',
        details: 'Password incorrect'
      });
    }
    
    console.log('User logged in successfully:', { 
      userId: user._id, 
      email: user.email, 
      role: user.role 
    });
    
    // Publish login event
    try {
      await publishEvent('user-events', {
        eventType: 'USER_LOGGED_IN',
        userId: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        timestamp: new Date().toISOString()
      });
      console.log('Login event published successfully');
    } catch (kafkaError) {
      console.error('Error publishing login event to Kafka (non-critical):', kafkaError);
      // Continue execution - don't fail if Kafka fails
    }
    
    res.json({
      message: 'Login successful',
      userId: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get all users (admin only in a real app, but simplified for POC)
app.get('/api/users', async (req, res) => {
  try {
    console.log('Fetching all users');
    const users = await User.find().select('-password');
    console.log(`Found ${users.length} users`);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      message: 'Server error fetching users',
      error: error.message
    });
  }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching user by ID: ${id}`);
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log(`Invalid user ID format: ${id}`);
      return res.status(400).json({ 
        message: 'Invalid user ID format',
        details: 'The ID provided is not a valid MongoDB ObjectId'
      });
    }
    
    const user = await User.findById(id).select('-password');
    if (!user) {
      console.log(`User not found with ID: ${id}`);
      return res.status(404).json({ 
        message: 'User not found',
        userId: id
      });
    }
    
    console.log(`Found user: ${user.email}`);
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      message: 'Server error fetching user',
      error: error.message,
      userId: req.params.id
    });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Closing MongoDB connection');
    await mongoose.connection.close();
    
    console.log('Disconnecting Kafka producer');
    if (producerConnected) {
      await producer.disconnect();
    }
    
    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
