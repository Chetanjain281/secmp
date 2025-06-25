const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3023;

// Kafka setup
const kafka = new Kafka({
  clientId: 'custody-oracle',
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

// Asset Valuation Schema
const AssetValuationSchema = new mongoose.Schema({
  assetId: {
    type: String,
    required: true,
    index: true
  },
  assetType: {
    type: String,
    required: true,
    enum: ['real_estate', 'private_equity', 'bonds', 'commodities', 'art', 'other']
  },
  currentValuation: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  custodian: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  lastVerified: {
    type: Date,
    default: Date.now
  },
  valuationHistory: [{
    value: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    method: { type: String, enum: ['market', 'appraisal', 'oracle', 'manual'], default: 'oracle' },
    confidence: { type: Number, min: 0, max: 1, default: 0.95 },
    source: { type: String, default: 'custody-oracle' }
  }],
  riskMetrics: {
    volatility: { type: Number, default: 0.03 },
    liquidityScore: { type: Number, min: 0, max: 1, default: 0.5 },
    marketDepth: { type: Number, default: 1000000 }
  },
  complianceStatus: {
    isCompliant: { type: Boolean, default: true },
    lastAudit: { type: Date },
    nextAudit: { type: Date },
    certifications: [String]
  },
  fees: {
    custodyFeeRate: { type: Number, default: 0.001 }, // 0.1% annual
    lastFeeCalculation: { type: Date },
    totalFeesCollected: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes for performance
AssetValuationSchema.index({ assetType: 1 });
AssetValuationSchema.index({ custodian: 1 });
AssetValuationSchema.index({ lastVerified: 1 });
AssetValuationSchema.index({ 'riskMetrics.volatility': 1 });

const AssetValuation = mongoose.model('AssetValuation', AssetValuationSchema);

// Custody Fund Mapping Schema
const CustodyFundMappingSchema = new mongoose.Schema({
  fundId: {
    type: String,
    required: true,
    index: true
  },
  assetId: {
    type: String,
    required: true
  },
  allocationPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  tokensAllocated: {
    type: Number,
    required: true,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index for fund-asset mapping
CustodyFundMappingSchema.index({ fundId: 1, assetId: 1 }, { unique: true });

const CustodyFundMapping = mongoose.model('CustodyFundMapping', CustodyFundMappingSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'custody-oracle',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    kafka: producerConnected ? 'connected' : 'disconnected',
    lastUpdate: new Date().toISOString()
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
          key: event.assetId || uuidv4(), 
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Event published to ${topic}:`, event);
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
  }
}

// Asset valuation calculation logic
function calculateAssetValuation(currentValue, assetType, timeElapsed) {
  const baseVolatility = parseFloat(process.env.ASSET_VOLATILITY) || 0.03;
  
  // Different volatility for different asset types
  const volatilityMultipliers = {
    'real_estate': 0.5,      // Lower volatility
    'private_equity': 1.5,   // Higher volatility
    'bonds': 0.3,           // Low volatility
    'commodities': 2.0,     // High volatility
    'art': 1.2,             // Medium-high volatility
    'other': 1.0            // Base volatility
  };
  
  const typeVolatility = baseVolatility * (volatilityMultipliers[assetType] || 1.0);
  
  // Random walk with mean reversion
  const randomFactor = (Math.random() - 0.5) * 2; // Range: -1 to 1
  const meanReversion = 0.98; // Slight mean reversion
  const changePercent = randomFactor * typeVolatility * Math.sqrt(timeElapsed / (365 * 24 * 60)); // Annualized
  
  const newValue = currentValue * meanReversion * (1 + changePercent);
  return Math.max(newValue, currentValue * 0.5); // Minimum 50% of original value
}

// Calculate custody fees
function calculateCustodyFees(assetValue, feeRate, timeElapsed) {
  const annualizedFee = assetValue * feeRate;
  const timeBasedFee = annualizedFee * (timeElapsed / (365 * 24 * 60 * 60 * 1000)); // Convert to years
  return timeBasedFee;
}

// Update asset valuations
async function updateAssetValuations() {
  try {
    console.log('Starting custody valuation update...');
    
    const assets = await AssetValuation.find({ 'complianceStatus.isCompliant': true });
    const updatePromises = [];
    
    for (const asset of assets) {
      const now = new Date();
      const lastUpdate = asset.valuationHistory.length > 0 
        ? asset.valuationHistory[asset.valuationHistory.length - 1].timestamp 
        : asset.createdAt;
      
      const timeElapsed = now - lastUpdate; // milliseconds
      const minimumUpdateInterval = 60000; // 1 minute minimum
      
      if (timeElapsed < minimumUpdateInterval) {
        continue; // Skip if updated too recently
      }
      
      // Calculate new valuation
      const newValuation = calculateAssetValuation(
        asset.currentValuation, 
        asset.assetType, 
        timeElapsed
      );
      
      // Calculate custody fees
      const custodyFees = calculateCustodyFees(
        asset.currentValuation,
        asset.fees.custodyFeeRate,
        timeElapsed
      );
      
      // Update asset
      const updatePromise = AssetValuation.findByIdAndUpdate(
        asset._id,
        {
          $set: {
            currentValuation: newValuation,
            lastVerified: now,
            'fees.lastFeeCalculation': now,
            'fees.totalFeesCollected': asset.fees.totalFeesCollected + custodyFees
          },
          $push: {
            valuationHistory: {
              value: newValuation,
              timestamp: now,
              method: 'oracle',
              confidence: 0.95,
              source: 'custody-oracle'
            }
          }
        },
        { new: true }
      ).then(updatedAsset => {
        // Publish custody update event
        return publishEvent('custody-events', {
          eventType: 'ASSET_VALUATION_UPDATED',
          assetId: asset.assetId,
          assetType: asset.assetType,
          oldValue: asset.currentValuation,
          newValue: newValuation,
          currency: asset.currency,
          custodian: asset.custodian,
          custodyFeesAccrued: custodyFees,
          confidence: 0.95,
          timestamp: now.toISOString(),
          source: 'custody-oracle'
        });
      });
      
      updatePromises.push(updatePromise);
    }
    
    await Promise.all(updatePromises);
    console.log(`Updated ${updatePromises.length} asset valuations`);
    
  } catch (error) {
    console.error('Error updating asset valuations:', error);
  }
}

// Setup periodic asset valuation updates
const updateInterval = parseInt(process.env.CUSTODY_UPDATE_INTERVAL_MINUTES) || 1;
console.log(`Setting up custody oracle updates every ${updateInterval} minute(s)`);

// Schedule updates every N minutes
cron.schedule(`*/${updateInterval} * * * *`, updateAssetValuations);

// API ENDPOINTS

// 1. Register new asset for custody tracking
app.post('/api/assets', async (req, res) => {
  try {
    const {
      assetId,
      assetType,
      initialValuation,
      currency = 'USD',
      custodian,
      location,
      riskMetrics = {},
      custodyFeeRate = 0.001
    } = req.body;
    
    // Check if asset already exists
    const existingAsset = await AssetValuation.findOne({ assetId });
    if (existingAsset) {
      return res.status(400).json({
        message: 'Asset already registered',
        assetId
      });
    }
    
    const newAsset = new AssetValuation({
      assetId,
      assetType,
      currentValuation: initialValuation,
      currency,
      custodian,
      location,
      riskMetrics: {
        volatility: riskMetrics.volatility || 0.03,
        liquidityScore: riskMetrics.liquidityScore || 0.5,
        marketDepth: riskMetrics.marketDepth || 1000000
      },
      fees: {
        custodyFeeRate
      },
      valuationHistory: [{
        value: initialValuation,
        timestamp: new Date(),
        method: 'manual',
        confidence: 1.0,
        source: 'initial-registration'
      }]
    });
    
    const savedAsset = await newAsset.save();
    
    // Publish asset registration event
    await publishEvent('custody-events', {
      eventType: 'ASSET_REGISTERED',
      assetId,
      assetType,
      initialValuation,
      custodian,
      location,
      timestamp: new Date().toISOString()
    });
    
    res.status(201).json({
      message: 'Asset registered successfully',
      asset: savedAsset
    });
    
  } catch (error) {
    console.error('Asset registration error:', error);
    res.status(500).json({
      message: 'Asset registration failed',
      error: error.message
    });
  }
});

// 2. Get asset valuation
app.get('/api/assets/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    
    const asset = await AssetValuation.findOne({ assetId });
    if (!asset) {
      return res.status(404).json({
        message: 'Asset not found',
        assetId
      });
    }
    
    res.status(200).json({
      assetId: asset.assetId,
      assetType: asset.assetType,
      currentValuation: asset.currentValuation,
      currency: asset.currency,
      custodian: asset.custodian,
      location: asset.location,
      lastVerified: asset.lastVerified,
      riskMetrics: asset.riskMetrics,
      complianceStatus: asset.complianceStatus,
      fees: asset.fees,
      valuationTrend: asset.valuationHistory.slice(-10) // Last 10 valuations
    });
    
  } catch (error) {
    console.error('Asset retrieval error:', error);
    res.status(500).json({
      message: 'Asset retrieval failed',
      error: error.message
    });
  }
});

// 3. Get all assets by custodian
app.get('/api/custodians/:custodian/assets', async (req, res) => {
  try {
    const { custodian } = req.params;
    
    const assets = await AssetValuation.find({ custodian }).select(
      'assetId assetType currentValuation currency location lastVerified complianceStatus.isCompliant'
    );
    
    const totalValue = assets.reduce((sum, asset) => sum + asset.currentValuation, 0);
    
    res.status(200).json({
      custodian,
      totalAssets: assets.length,
      totalValue,
      currency: 'USD',
      assets,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Custodian assets retrieval error:', error);
    res.status(500).json({
      message: 'Custodian assets retrieval failed',
      error: error.message
    });
  }
});

// 4. Create fund-asset custody mapping
app.post('/api/fund-mappings', async (req, res) => {
  try {
    const {
      fundId,
      assetId,
      allocationPercentage,
      tokensAllocated
    } = req.body;
    
    // Verify asset exists
    const asset = await AssetValuation.findOne({ assetId });
    if (!asset) {
      return res.status(404).json({
        message: 'Asset not found',
        assetId
      });
    }
    
    // Check if mapping already exists
    const existingMapping = await CustodyFundMapping.findOne({ fundId, assetId });
    if (existingMapping) {
      return res.status(400).json({
        message: 'Fund-asset mapping already exists',
        fundId,
        assetId
      });
    }
    
    const newMapping = new CustodyFundMapping({
      fundId,
      assetId,
      allocationPercentage,
      tokensAllocated
    });
    
    const savedMapping = await newMapping.save();
    
    // Publish fund mapping event
    await publishEvent('custody-events', {
      eventType: 'FUND_ASSET_MAPPED',
      fundId,
      assetId,
      allocationPercentage,
      tokensAllocated,
      assetValue: asset.currentValuation,
      timestamp: new Date().toISOString()
    });
    
    res.status(201).json({
      message: 'Fund-asset mapping created successfully',
      mapping: savedMapping
    });
    
  } catch (error) {
    console.error('Fund mapping error:', error);
    res.status(500).json({
      message: 'Fund mapping failed',
      error: error.message
    });
  }
});

// 5. Get fund's custody assets
app.get('/api/funds/:fundId/custody', async (req, res) => {
  try {
    const { fundId } = req.params;
    
    const mappings = await CustodyFundMapping.find({ fundId, isActive: true });
    
    const assetDetails = await Promise.all(
      mappings.map(async (mapping) => {
        const asset = await AssetValuation.findOne({ assetId: mapping.assetId });
        return {
          ...mapping.toObject(),
          assetDetails: asset ? {
            assetType: asset.assetType,
            currentValuation: asset.currentValuation,
            currency: asset.currency,
            custodian: asset.custodian,
            location: asset.location,
            lastVerified: asset.lastVerified,
            complianceStatus: asset.complianceStatus.isCompliant
          } : null
        };
      })
    );
    
    const totalValue = assetDetails.reduce((sum, item) => {
      if (item.assetDetails) {
        return sum + (item.assetDetails.currentValuation * item.allocationPercentage / 100);
      }
      return sum;
    }, 0);
    
    res.status(200).json({
      fundId,
      totalMappings: assetDetails.length,
      totalCustodyValue: totalValue,
      currency: 'USD',
      mappings: assetDetails,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Fund custody retrieval error:', error);
    res.status(500).json({
      message: 'Fund custody retrieval failed',
      error: error.message
    });
  }
});

// 6. Get custody analytics
app.get('/api/analytics/custody', async (req, res) => {
  try {
    const totalAssets = await AssetValuation.countDocuments();
    const totalValue = await AssetValuation.aggregate([
      { $group: { _id: null, total: { $sum: '$currentValuation' } } }
    ]);
    
    const assetsByType = await AssetValuation.aggregate([
      { $group: { _id: '$assetType', count: { $sum: 1 }, value: { $sum: '$currentValuation' } } }
    ]);
    
    const custodianStats = await AssetValuation.aggregate([
      { $group: { _id: '$custodian', count: { $sum: 1 }, value: { $sum: '$currentValuation' } } }
    ]);
    
    const complianceStats = await AssetValuation.aggregate([
      { $group: { 
          _id: '$complianceStatus.isCompliant', 
          count: { $sum: 1 },
          value: { $sum: '$currentValuation' } 
        } }
    ]);
    
    res.status(200).json({
      summary: {
        totalAssets,
        totalValue: totalValue[0]?.total || 0,
        currency: 'USD'
      },
      breakdown: {
        byAssetType: assetsByType,
        byCustodian: custodianStats,
        byCompliance: complianceStats
      },
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Custody analytics error:', error);
    res.status(500).json({
      message: 'Custody analytics retrieval failed',
      error: error.message
    });
  }
});

// 7. Force asset valuation update
app.post('/api/assets/:assetId/update-valuation', async (req, res) => {
  try {
    const { assetId } = req.params;
    const { valuation, method = 'manual', source = 'api-update' } = req.body;
    
    const asset = await AssetValuation.findOne({ assetId });
    if (!asset) {
      return res.status(404).json({
        message: 'Asset not found',
        assetId
      });
    }
    
    const oldValue = asset.currentValuation;
    
    const updatedAsset = await AssetValuation.findOneAndUpdate(
      { assetId },
      {
        $set: {
          currentValuation: valuation,
          lastVerified: new Date()
        },
        $push: {
          valuationHistory: {
            value: valuation,
            timestamp: new Date(),
            method,
            confidence: method === 'manual' ? 1.0 : 0.95,
            source
          }
        }
      },
      { new: true }
    );
    
    // Publish valuation update event
    await publishEvent('custody-events', {
      eventType: 'ASSET_VALUATION_MANUAL_UPDATE',
      assetId,
      assetType: asset.assetType,
      oldValue,
      newValue: valuation,
      method,
      source,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      message: 'Asset valuation updated successfully',
      assetId,
      oldValue,
      newValue: valuation,
      asset: updatedAsset
    });
    
  } catch (error) {
    console.error('Asset valuation update error:', error);
    res.status(500).json({
      message: 'Asset valuation update failed',
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
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
  console.log('Shutting down custody oracle gracefully...');
  if (producerConnected) {
    await producer.disconnect();
  }
  await mongoose.connection.close();
  process.exit(0);
});

const server = process.env.NODE_ENV === 'test' ? null : app.listen(PORT, () => {
  console.log(`Custody Oracle running on port ${PORT}`);
  console.log(`Update interval: ${updateInterval} minute(s)`);
});

module.exports = { app, server };
