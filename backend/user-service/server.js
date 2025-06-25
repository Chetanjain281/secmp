const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3012;

// Kafka setup
const kafka = new Kafka({
  clientId: 'user-service',
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

// User Profile Schema (Extended from auth service)
const UserProfileSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  profile: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String },
    dateOfBirth: { type: Date },
    nationality: { type: String },
    country: { type: String, required: true },
    city: { type: String },
    address: { type: String },
    walletAddress: { 
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^0x[a-fA-F0-9]{40}$/.test(v);
        },
        message: 'Invalid Ethereum wallet address format'
      }
    }
  },
  role: {
    type: String,
    enum: ['admin', 'fund_house', 'investor'],
    required: true
  },
  
  // KYB (Know Your Business) for fund houses
  kybStatus: {
    type: String,
    enum: ['not_started', 'pending', 'approved', 'rejected', 'expired'],
    default: 'not_started'
  },
  kybData: {
    companyName: { type: String },
    companyRegistrationNumber: { type: String },
    companyAddress: { type: String },
    companyCountry: { type: String },
    businessType: { 
      type: String,
      enum: ['private_equity', 'hedge_fund', 'asset_management', 'other']
    },
    regulatoryLicense: { type: String },
    aum: { type: Number }, // Assets Under Management
    establishedYear: { type: Number },
    documents: [{
      type: { 
        type: String,
        enum: ['company_registration', 'regulatory_license', 'audited_financials', 'board_resolution', 'other']
      },
      filename: { type: String },
      uploadedAt: { type: Date, default: Date.now },
      status: { 
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      }
    }],
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: String }, // Admin user ID
    rejectionReason: { type: String }
  },
  
  // Suitability Assessment for investors
  suitabilityStatus: {
    type: String,
    enum: ['not_started', 'completed', 'expired'],
    default: 'not_started'
  },
  suitabilityData: {
    incomeLevel: {
      type: String,
      enum: ['under_50L', '50L_1Cr', '1Cr_5Cr', '5Cr_plus']
    },
    experience: {
      type: String,
      enum: ['beginner', 'intermediate', 'expert']
    },
    riskTolerance: {
      type: String,
      enum: ['conservative', 'moderate', 'aggressive']
    },
    netWorth: {
      type: String,
      enum: ['under_1Cr', '1Cr_5Cr', '5Cr_10Cr', '10Cr_plus']
    },
    investmentHorizon: {
      type: String,
      enum: ['short_term', 'medium_term', 'long_term']
    },
    geography: {
      type: String,
      enum: ['domestic', 'international', 'both']
    },
    previousInvestments: [{
      type: { type: String },
      amount: { type: Number },
      duration: { type: String }
    }],
    completedAt: { type: Date },
    score: { type: Number, min: 0, max: 100 },
    eligibleFundTypes: [{ 
      type: String,
      enum: ['private_equity', 'hedge_fund', 'real_estate', 'alternative']
    }]
  },
  
  // Profile Status
  profileStatus: {
    type: String,
    enum: ['incomplete', 'pending_verification', 'verified', 'suspended'],
    default: 'incomplete'
  },
  
  // Metadata
  lastLoginAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes for performance
UserProfileSchema.index({ email: 1 });
UserProfileSchema.index({ role: 1 });
UserProfileSchema.index({ kybStatus: 1 });
UserProfileSchema.index({ suitabilityStatus: 1 });
UserProfileSchema.index({ profileStatus: 1 });
UserProfileSchema.index({ 'profile.country': 1 });

const UserProfile = mongoose.model('UserProfile', UserProfileSchema);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, PNG files allowed.'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'user-service',
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
    throw error;
  }
}

// Validation middleware
const validateProfile = [
  body('profile.firstName').notEmpty().withMessage('First name is required'),
  body('profile.lastName').notEmpty().withMessage('Last name is required'),
  body('profile.country').notEmpty().withMessage('Country is required'),
  body('profile.phone').optional().isMobilePhone().withMessage('Invalid phone number'),
  body('profile.walletAddress').optional().matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid Ethereum address'),
  body('role').isIn(['admin', 'fund_house', 'investor']).withMessage('Invalid role')
];

// Suitability calculation function
function calculateSuitabilityScore(data) {
  let score = 0;
  const eligibleFundTypes = [];
  
  // Income level scoring
  const incomeScores = {
    'under_50L': 10,
    '50L_1Cr': 20,
    '1Cr_5Cr': 30,
    '5Cr_plus': 40
  };
  score += incomeScores[data.incomeLevel] || 0;
  
  // Experience scoring
  const experienceScores = {
    'beginner': 10,
    'intermediate': 20,
    'expert': 30
  };
  score += experienceScores[data.experience] || 0;
  
  // Risk tolerance scoring
  const riskScores = {
    'conservative': 5,
    'moderate': 15,
    'aggressive': 20
  };
  score += riskScores[data.riskTolerance] || 0;
  
  // Net worth scoring
  const networthScores = {
    'under_1Cr': 5,
    '1Cr_5Cr': 10,
    '5Cr_10Cr': 10,
    '10Cr_plus': 10
  };
  score += networthScores[data.netWorth] || 0;
    // Determine eligible fund types based on score and criteria
  if (score >= 70 && data.incomeLevel !== 'under_50L') {
    eligibleFundTypes.push('private_equity', 'hedge_fund', 'real_estate', 'alternative');
  } else if (score >= 40 && (data.incomeLevel === '50L_1Cr' || data.incomeLevel === '1Cr_5Cr')) {
    eligibleFundTypes.push('real_estate', 'alternative');
  } else if (score >= 25) {
    eligibleFundTypes.push('alternative');
  }
  
  return { score, eligibleFundTypes };
}

// API ENDPOINTS

// 1. Create or update user profile
app.post('/api/profile', async (req, res) => {
  try {
    const { userId, email, profile, role } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({
        message: 'userId and email are required'
      });
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check if profile exists
    let userProfile = await UserProfile.findOne({ userId });
    
    if (userProfile) {
      // Update existing profile
      userProfile.profile = { ...userProfile.profile, ...profile };
      userProfile.role = role || userProfile.role;
      userProfile.updatedAt = new Date();
      
      if (userProfile.profileStatus === 'incomplete') {
        userProfile.profileStatus = 'pending_verification';
      }
    } else {
      // Create new profile
      userProfile = new UserProfile({
        userId,
        email,
        profile,
        role,
        profileStatus: 'pending_verification'
      });
    }

    const savedProfile = await userProfile.save();

    // Publish event
    await publishEvent('user-events', {
      eventType: 'PROFILE_UPDATED',
      userId,
      email,
      profile: savedProfile.profile,
      role: savedProfile.role,
      profileStatus: savedProfile.profileStatus,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Profile updated successfully',
      profile: savedProfile
    });
  } catch (error) {
    console.error('Profile update error:', error);
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        path: err.path,
        msg: err.message
      }));
      
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors
      });
    }
    
    res.status(500).json({
      message: 'Profile update failed',
      error: error.message
    });
  }
});

// 2. Get user profile
app.get('/api/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }

    res.status(200).json({
      profile: userProfile
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      message: 'Failed to retrieve profile',
      error: error.message
    });
  }
});

// 3. Submit KYB documents (Fund Houses only)
app.post('/api/kyb/submit/:userId', upload.single('company_registration'), async (req, res) => {
  try {
    const { userId } = req.params;
    const kybData = req.body.kybData ? JSON.parse(req.body.kybData) : {};
    
    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }
    
    if (userProfile.role !== 'fund_house') {
      return res.status(403).json({
        message: 'KYB is only available for fund houses'
      });
    }

    // For test environment, we don't need actual file uploads
    let documents = [];
    if (req.files && Array.isArray(req.files)) {
      documents = req.files.map(file => ({
        type: file.fieldname,
        filename: file.filename,
        uploadedAt: new Date(),
        status: 'pending'
      }));
    }

    // Update KYB data
    userProfile.kybData = {
      ...kybData,
      documents,
      submittedAt: new Date()
    };
    userProfile.kybStatus = 'pending';

    const savedProfile = await userProfile.save();

    // Publish event
    await publishEvent('user-events', {
      eventType: 'KYB_SUBMITTED',
      userId,
      email: userProfile.email,
      companyName: kybData.companyName,
      documentsCount: documents.length,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'KYB documents submitted successfully',
      kybStatus: savedProfile.kybStatus,
      submittedAt: savedProfile.kybData.submittedAt
    });

  } catch (error) {
    console.error('KYB submission error:', error);
    res.status(500).json({
      message: 'KYB submission failed',
      error: error.message
    });
  }
});

// 4. Approve/Reject KYB (Admin only)
app.post('/api/kyb/review/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reviewedBy, rejectionReason } = req.body;
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be either approved or rejected'
      });
    }

    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }
    
    if (userProfile.kybStatus !== 'pending') {
      return res.status(400).json({
        message: 'KYB is not in pending status'
      });
    }

    // Update KYB status
    userProfile.kybStatus = status;
    userProfile.kybData.reviewedAt = new Date();
    userProfile.kybData.reviewedBy = reviewedBy;
    
    if (status === 'rejected' && rejectionReason) {
      userProfile.kybData.rejectionReason = rejectionReason;
    }
    
    if (status === 'approved') {
      userProfile.profileStatus = 'verified';
    }

    const savedProfile = await userProfile.save();

    // Publish event
    await publishEvent('user-events', {
      eventType: 'KYB_REVIEWED',
      userId,
      email: userProfile.email,
      kybStatus: status,
      reviewedBy,
      rejectionReason,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: `KYB ${status} successfully`,
      kybStatus: savedProfile.kybStatus,
      reviewedAt: savedProfile.kybData.reviewedAt
    });

  } catch (error) {
    console.error('KYB review error:', error);
    res.status(500).json({
      message: 'KYB review failed',
      error: error.message
    });
  }
});

// 5. Submit suitability assessment (Investors only)
app.post('/api/suitability/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const suitabilityData = req.body;
    
    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }
    
    if (userProfile.role !== 'investor') {
      return res.status(403).json({
        message: 'Suitability assessment is only available for investors'
      });
    }

    // Calculate suitability score
    const { score, eligibleFundTypes } = calculateSuitabilityScore(suitabilityData);

    // Update suitability data
    userProfile.suitabilityData = {
      ...suitabilityData,
      completedAt: new Date(),
      score,
      eligibleFundTypes
    };
    userProfile.suitabilityStatus = 'completed';
    userProfile.profileStatus = 'verified';

    const savedProfile = await userProfile.save();

    // Publish event
    await publishEvent('user-events', {
      eventType: 'SUITABILITY_COMPLETED',
      userId,
      email: userProfile.email,
      score,
      eligibleFundTypes,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Suitability assessment completed successfully',
      score,
      eligibleFundTypes,
      suitabilityStatus: savedProfile.suitabilityStatus
    });

  } catch (error) {
    console.error('Suitability assessment error:', error);
    res.status(500).json({
      message: 'Suitability assessment failed',
      error: error.message
    });
  }
});

// 6. Check fund eligibility for user
app.get('/api/eligibility/:userId/:fundId', async (req, res) => {
  try {
    const { userId, fundId } = req.params;
    
    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }
    
    if (userProfile.role !== 'investor') {
      return res.status(403).json({
        message: 'Eligibility check is only for investors'
      });
    }
    
    if (userProfile.suitabilityStatus !== 'completed') {
      return res.status(400).json({
        message: 'Suitability assessment not completed',
        eligible: false,
        reason: 'Complete suitability assessment first'
      });
    }    // For now, return basic eligibility - in real implementation, 
    // this would check against specific fund requirements
    const eligible = userProfile.suitabilityData.score >= 25;
    
    res.status(200).json({
      eligible,
      score: userProfile.suitabilityData.score,
      eligibleFundTypes: userProfile.suitabilityData.eligibleFundTypes,
      reason: eligible ? 'User meets minimum requirements' : 'User does not meet minimum requirements'
    });

  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({
      message: 'Eligibility check failed',
      error: error.message
    });
  }
});

// 7. Get all users (Admin only)
app.get('/api/users', async (req, res) => {
  try {
    const { role, kybStatus, suitabilityStatus, page = 1, limit = 20 } = req.query;
    
    const filter = {};
    if (role) filter.role = role;
    if (kybStatus) filter.kybStatus = kybStatus;
    if (suitabilityStatus) filter.suitabilityStatus = suitabilityStatus;

    const skip = (page - 1) * limit;
    
    const users = await UserProfile.find(filter)
      .select('-kybData.documents') // Exclude document details for performance
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await UserProfile.countDocuments(filter);

    res.status(200).json({
      users,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      message: 'Failed to retrieve users',
      error: error.message
    });
  }
});

// 8. Update profile status (Admin only)
app.patch('/api/profile/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { profileStatus, updatedBy } = req.body;
    
    const validStatuses = ['incomplete', 'pending_verification', 'verified', 'suspended'];
    if (!validStatuses.includes(profileStatus)) {
      return res.status(400).json({
        message: 'Invalid profile status',
        validStatuses
      });
    }

    const userProfile = await UserProfile.findOne({ userId });
    
    if (!userProfile) {
      return res.status(404).json({
        message: 'User profile not found'
      });
    }

    const oldStatus = userProfile.profileStatus;
    userProfile.profileStatus = profileStatus;
    userProfile.updatedAt = new Date();

    const savedProfile = await userProfile.save();

    // Publish event
    await publishEvent('user-events', {
      eventType: 'PROFILE_STATUS_UPDATED',
      userId,
      email: userProfile.email,
      oldStatus,
      newStatus: profileStatus,
      updatedBy,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Profile status updated successfully',
      profileStatus: savedProfile.profileStatus
    });

  } catch (error) {
    console.error('Profile status update error:', error);
    res.status(500).json({
      message: 'Profile status update failed',
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'File size too large. Maximum size is 10MB.'
      });
    }
  }
  
  res.status(500).json({
    message: 'Internal server error',
    error: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (producerConnected) {
    await producer.disconnect();
  }
  await mongoose.connection.close();
  process.exit(0);
});

const server = process.env.NODE_ENV === 'test' ? null : app.listen(PORT, () => {
  console.log(`User service running on port ${PORT}`);
});

module.exports = { app, server };
