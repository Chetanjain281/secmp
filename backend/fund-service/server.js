const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const Web3 = require('web3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3013;

// Kafka setup
const kafka = new Kafka({
  clientId: 'fund-service',
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

// Fund Schema
const FundSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  symbol: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    required: true
  },
  fundType: {
    type: String,
    required: true,
    enum: ['private_equity', 'hedge_fund', 'real_estate', 'other']
  },
  contractAddress: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid Ethereum address format'
    }
  },
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  managerWalletAddress: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid Ethereum address format'
    }
  },
  currentNAV: {
    type: Number,
    required: true,
    min: 0
  },
  minimumInvestment: {
    type: Number,
    required: true,
    min: 0
  },
  totalSupply: {
    type: Number,
    default: 0,
    min: 0
  },
  availableTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  custodyInfo: {
    custodianName: { type: String },
    assetTypes: [{ type: String }],
    assetValues: [{ type: Number }],
    documentHash: { type: String },
    verificationStatus: { 
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    verifiedAt: { type: Date },
    verifiedBy: { type: String }
  },
  suitabilityCriteria: {
    minIncomeLevel: { 
      type: String,
      enum: ['under_50L', '50L_1Cr', '1Cr_5Cr', '5Cr_plus']
    },
    minExperience: { 
      type: String,
      enum: ['beginner', 'intermediate', 'expert']
    },
    allowedRiskTolerance: [{ 
      type: String,
      enum: ['conservative', 'moderate', 'aggressive']
    }],
    allowedGeography: [{ type: String }]
  },
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'active', 'paused', 'terminated'],
    default: 'draft'
  },
  documents: [{
    type: { 
      type: String,
      enum: ['offering_memorandum', 'financial_statements', 'regulatory_filings', 'marketing_material', 'other']
    },
    filename: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes for performance
FundSchema.index({ name: 1 });
FundSchema.index({ symbol: 1 }, { unique: true });
FundSchema.index({ fundType: 1 });
FundSchema.index({ managerId: 1 });
FundSchema.index({ status: 1 });
FundSchema.index({ 'custodyInfo.verificationStatus': 1 });

const Fund = mongoose.model('Fund', FundSchema);

// NAV History Schema
const NAVHistorySchema = new mongoose.Schema({
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fund',
    required: true
  },
  nav: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

NAVHistorySchema.index({ fundId: 1, timestamp: -1 });

const NAVHistory = mongoose.model('NAVHistory', NAVHistorySchema);

// Multer setup for document uploads
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
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, PNG files allowed.'));
    }
  }
});

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'fund-service',
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
          key: event.fundId || uuidv4(), 
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
const validateFundCreation = [
  body('name').notEmpty().withMessage('Fund name is required'),
  body('symbol').notEmpty().withMessage('Fund symbol is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('fundType').isIn(['private_equity', 'hedge_fund', 'real_estate', 'other']).withMessage('Invalid fund type'),
  body('managerId').notEmpty().withMessage('Manager ID is required'),
  body('managerWalletAddress').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid manager wallet address'),
  body('currentNAV').isFloat({ min: 0 }).withMessage('NAV must be a positive number'),
  body('minimumInvestment').isFloat({ min: 0 }).withMessage('Minimum investment must be a positive number')
];

// API ENDPOINTS

// 1. Create new fund
app.post('/api/funds', validateFundCreation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      name,
      symbol,
      description,
      fundType,
      managerId,
      managerWalletAddress,
      currentNAV,
      minimumInvestment,
      suitabilityCriteria
    } = req.body;

    // Check if symbol is already in use
    const existingFund = await Fund.findOne({ symbol });
    if (existingFund) {
      return res.status(400).json({
        message: 'Fund symbol already in use'
      });
    }
    
    // Create new fund
    const fund = new Fund({
      name,
      symbol,
      description,
      fundType,
      managerId,
      managerWalletAddress,
      currentNAV,
      minimumInvestment,
      suitabilityCriteria,
      status: 'draft'
    });

    const savedFund = await fund.save();

    // Record initial NAV
    const navHistory = new NAVHistory({
      fundId: savedFund._id,
      nav: currentNAV
    });
    await navHistory.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'FUND_CREATED',
      fundId: savedFund._id.toString(),
      name: savedFund.name,
      symbol: savedFund.symbol,
      fundType: savedFund.fundType,
      managerId: savedFund.managerId.toString(),
      status: savedFund.status,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      message: 'Fund created successfully',
      fund: savedFund
    });

  } catch (error) {
    console.error('Fund creation error:', error);
    
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
      message: 'Fund creation failed',
      error: error.message
    });
  }
});

// 2. Get all funds
app.get('/api/funds', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      fundType, 
      managerId 
    } = req.query;

    const query = {};
    
    if (status) query.status = status;
    if (fundType) query.fundType = fundType;
    if (managerId) query.managerId = managerId;

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };

    const funds = await Fund.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort);
    
    const totalFunds = await Fund.countDocuments(query);

    res.status(200).json({
      funds,
      currentPage: options.page,
      totalPages: Math.ceil(totalFunds / options.limit),
      totalFunds
    });

  } catch (error) {
    console.error('Error fetching funds:', error);
    res.status(500).json({
      message: 'Failed to retrieve funds',
      error: error.message
    });
  }
});

// 3. Get fund by ID
app.get('/api/funds/:fundId', async (req, res) => {
  try {
    const { fundId } = req.params;
    
    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    res.status(200).json({
      fund
    });

  } catch (error) {
    console.error('Error fetching fund details:', error);
    res.status(500).json({
      message: 'Failed to retrieve fund details',
      error: error.message
    });
  }
});

// 4. Update fund details
app.put('/api/funds/:fundId', async (req, res) => {
  try {
    const { fundId } = req.params;
    const updateData = req.body;

    // Don't allow status changes through this endpoint
    if (updateData.status) {
      delete updateData.status;
    }

    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Only allow updates to draft funds
    if (fund.status !== 'draft') {
      return res.status(400).json({
        message: 'Only draft funds can be updated'
      });
    }

    // Update fund
    Object.keys(updateData).forEach(key => {
      fund[key] = updateData[key];
    });
    
    fund.updatedAt = new Date();
    
    const updatedFund = await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'FUND_UPDATED',
      fundId: updatedFund._id.toString(),
      name: updatedFund.name,
      symbol: updatedFund.symbol,
      fundType: updatedFund.fundType,
      managerId: updatedFund.managerId.toString(),
      status: updatedFund.status,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Fund updated successfully',
      fund: updatedFund
    });

  } catch (error) {
    console.error('Fund update error:', error);
    
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
      message: 'Fund update failed',
      error: error.message
    });
  }
});

// 5. Upload fund document
app.post('/api/funds/:fundId/documents', upload.single('document'), async (req, res) => {
  try {
    const { fundId } = req.params;
    const { documentType } = req.body;

    if (!req.file) {
      return res.status(400).json({
        message: 'No document uploaded'
      });
    }

    const validDocumentTypes = ['offering_memorandum', 'financial_statements', 'regulatory_filings', 'marketing_material', 'other'];
    if (!validDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        message: 'Invalid document type'
      });
    }

    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Add document to fund
    fund.documents.push({
      type: documentType,
      filename: req.file.filename,
      uploadedAt: new Date()
    });
    
    await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'FUND_DOCUMENT_UPLOADED',
      fundId: fund._id.toString(),
      documentType,
      filename: req.file.filename,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Document uploaded successfully',
      document: {
        type: documentType,
        filename: req.file.filename,
        uploadedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({
      message: 'Document upload failed',
      error: error.message
    });
  }
});

// 6. Submit fund for approval
app.post('/api/funds/:fundId/submit', async (req, res) => {
  try {
    const { fundId } = req.params;
    
    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Check if fund is in draft status
    if (fund.status !== 'draft') {
      return res.status(400).json({
        message: `Fund cannot be submitted in ${fund.status} status`
      });
    }

    // Check required documents
    if (!fund.documents.some(doc => doc.type === 'offering_memorandum')) {
      return res.status(400).json({
        message: 'Offering memorandum is required'
      });
    }

    // Update status
    fund.status = 'pending_approval';
    fund.updatedAt = new Date();
    
    await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'FUND_SUBMITTED',
      fundId: fund._id.toString(),
      name: fund.name,
      symbol: fund.symbol,
      fundType: fund.fundType,
      managerId: fund.managerId.toString(),
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Fund submitted for approval',
      fund
    });

  } catch (error) {
    console.error('Fund submission error:', error);
    res.status(500).json({
      message: 'Fund submission failed',
      error: error.message
    });
  }
});

// 7. Admin approve/reject fund
app.post('/api/funds/:fundId/review', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { status, reviewedBy, rejectionReason } = req.body;

    if (!['active', 'rejected'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be either "active" or "rejected"'
      });
    }

    if (!reviewedBy) {
      return res.status(400).json({
        message: 'Reviewer ID is required'
      });
    }

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({
        message: 'Rejection reason is required'
      });
    }

    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Check if fund is in pending_approval status
    if (fund.status !== 'pending_approval') {
      return res.status(400).json({
        message: `Fund review not allowed in ${fund.status} status`
      });
    }

    // Update status
    fund.status = status;
    fund.updatedAt = new Date();
    
    // If rejected, store reason
    if (status === 'rejected') {
      fund.rejectionReason = rejectionReason;
    }
    
    await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'FUND_REVIEWED',
      fundId: fund._id.toString(),
      name: fund.name,
      symbol: fund.symbol,
      status: fund.status,
      reviewedBy,
      rejectionReason,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: `Fund ${status === 'active' ? 'approved' : 'rejected'}`,
      fund
    });

  } catch (error) {
    console.error('Fund review error:', error);
    res.status(500).json({
      message: 'Fund review failed',
      error: error.message
    });
  }
});

// 8. Update NAV
app.post('/api/funds/:fundId/nav', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { nav } = req.body;

    if (!nav || isNaN(nav) || nav <= 0) {
      return res.status(400).json({
        message: 'Valid NAV value is required'
      });
    }

    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Update NAV
    fund.currentNAV = nav;
    fund.updatedAt = new Date();
    
    await fund.save();

    // Record NAV history
    const navHistory = new NAVHistory({
      fundId: fund._id,
      nav
    });
    await navHistory.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'NAV_UPDATED',
      fundId: fund._id.toString(),
      symbol: fund.symbol,
      previousNAV: fund.currentNAV,
      newNAV: nav,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'NAV updated successfully',
      fund
    });

  } catch (error) {
    console.error('NAV update error:', error);
    res.status(500).json({
      message: 'NAV update failed',
      error: error.message
    });
  }
});

// 9. Get NAV history
app.get('/api/funds/:fundId/nav/history', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { days = 30 } = req.query;
    
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days, 10));
    
    const navHistory = await NAVHistory.find({
      fundId,
      timestamp: { $gte: daysAgo }
    }).sort({ timestamp: 1 });

    res.status(200).json({
      message: 'NAV history retrieved successfully',
      history: navHistory
    });

  } catch (error) {
    console.error('Error retrieving NAV history:', error);
    res.status(500).json({
      message: 'Failed to retrieve NAV history',
      error: error.message
    });
  }
});

// 10. Deploy fund to blockchain
app.post('/api/funds/:fundId/deploy', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { initialSupply } = req.body;
    
    if (!initialSupply || isNaN(initialSupply) || initialSupply <= 0) {
      return res.status(400).json({
        message: 'Valid initial token supply is required'
      });
    }
    
    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Check if fund is in active status
    if (fund.status !== 'active') {
      return res.status(400).json({
        message: 'Only active funds can be deployed'
      });
    }

    // Check if already deployed
    if (fund.contractAddress) {
      return res.status(400).json({
        message: 'Fund is already deployed to blockchain'
      });
    }

    // In a real implementation, this would interact with the blockchain service
    // For now, we'll mock it with a delay and a fake contract address
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockContractAddress = '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    
    fund.contractAddress = mockContractAddress;
    fund.totalSupply = initialSupply;
    fund.availableTokens = initialSupply; // Initially all tokens are available
    fund.updatedAt = new Date();
    
    await fund.save();

    // Publish event for fund deployment
    await publishEvent('fund-events', {
      eventType: 'FUND_DEPLOYED',
      fundId: fund._id.toString(),
      name: fund.name,
      symbol: fund.symbol,
      contractAddress: mockContractAddress,
      initialSupply,
      timestamp: new Date().toISOString()
    });
    
    // Publish event for token supply
    await publishEvent('token-events', {
      eventType: 'TOKEN_SUPPLY_CREATED',
      fundId: fund._id.toString(),
      symbol: fund.symbol,
      totalSupply: initialSupply,
      availableTokens: initialSupply,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Fund deployed to blockchain',
      fund
    });

  } catch (error) {
    console.error('Fund deployment error:', error);
    res.status(500).json({
      message: 'Fund deployment failed',
      error: error.message
    });
  }
});

// 11. Verify custody information
app.post('/api/funds/:fundId/custody/verify', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { verifiedBy, assetValues } = req.body;

    if (!verifiedBy) {
      return res.status(400).json({
        message: 'Verifier ID is required'
      });
    }

    const fund = await Fund.findById(fundId);
    
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Only allow verification for funds in active status
    if (fund.status !== 'active') {
      return res.status(400).json({
        message: 'Only active funds can have custody verification'
      });
    }

    // Update custody information
    fund.custodyInfo.verificationStatus = 'verified';
    fund.custodyInfo.verifiedAt = new Date();
    fund.custodyInfo.verifiedBy = verifiedBy;
    
    // Update asset values if provided
    if (assetValues && Array.isArray(assetValues) && assetValues.length > 0) {
      fund.custodyInfo.assetValues = assetValues;
    }
    
    await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: 'CUSTODY_VERIFIED',
      fundId: fund._id.toString(),
      name: fund.name,
      symbol: fund.symbol,
      verifiedBy,
      assetValues: fund.custodyInfo.assetValues,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Custody information verified',
      fund
    });

  } catch (error) {
    console.error('Custody verification error:', error);
    res.status(500).json({
      message: 'Custody verification failed',
      error: error.message
    });
  }
});

// 11. Pause/Unpause Fund
app.patch('/api/funds/:fundId/status', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { action } = req.body;
    
    if (!['pause', 'unpause'].includes(action)) {
      return res.status(400).json({
        message: 'Invalid action - must be either "pause" or "unpause"'
      });
    }

    const fund = await Fund.findById(fundId);
    if (!fund) {
      return res.status(404).json({
        message: 'Fund not found'
      });
    }

    // Only active funds can be paused and only paused funds can be unpaused
    if (action === 'pause' && fund.status !== 'active') {
      return res.status(400).json({
        message: 'Only active funds can be paused'
      });
    }

    if (action === 'unpause' && fund.status !== 'paused') {
      return res.status(400).json({
        message: 'Only paused funds can be unpaused'
      });
    }

    // Update the status
    fund.status = action === 'pause' ? 'paused' : 'active';
    const updatedFund = await fund.save();

    // Publish event
    await publishEvent('fund-events', {
      eventType: action === 'pause' ? 'FUND_PAUSED' : 'FUND_UNPAUSED',
      fundId: fund._id.toString(),
      name: fund.name,
      symbol: fund.symbol,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: `Fund ${action === 'pause' ? 'paused' : 'unpaused'} successfully`,
      fund: updatedFund
    });
  } catch (error) {
    console.error(`Fund ${req.body.action} error:`, error);
    res.status(500).json({
      message: `Failed to ${req.body.action} fund`,
      error: error.message
    });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Fund service running on port ${PORT}`);
});

module.exports = { app, server };
