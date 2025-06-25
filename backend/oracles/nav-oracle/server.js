const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3021;

// Kafka setup
const kafka = new Kafka({
  clientId: 'nav-oracle',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'nav-oracle-group' });
let producerConnected = false;
let consumerConnected = false;

// Connect Kafka producer
async function connectProducer() {
  try {
    await producer.connect();
    console.log('Kafka producer connected');
    producerConnected = true;
  } catch (error) {
    console.error('Error connecting to Kafka producer:', error);
    setTimeout(connectProducer, 5000);
  }
}

// Connect Kafka consumer
async function connectConsumer() {
  try {
    await consumer.connect();
    console.log('Kafka consumer connected');
    
    // Subscribe to fund events to track new funds
    await consumer.subscribe({ topics: ['fund-events'], fromBeginning: false });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const eventData = JSON.parse(message.value.toString());
        console.log(`Received event from ${topic}:`, eventData);
        
        if (topic === 'fund-events') {
          await handleFundEvent(eventData);
        }
      },
    });
    
    consumerConnected = true;
  } catch (error) {
    console.error('Error connecting to Kafka consumer:', error);
    setTimeout(connectConsumer, 5000);
  }
}

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// NAV Price History Schema
const NAVPriceSchema = new mongoose.Schema({
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  fundSymbol: {
    type: String,
    required: true,
    index: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  previousPrice: {
    type: Number,
    default: null
  },
  changeAmount: {
    type: Number,
    default: 0
  },
  changePercent: {
    type: Number,
    default: 0
  },
  volume: {
    type: Number,
    default: 0
  },
  marketCap: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  marketStatus: {
    type: String,
    enum: ['OPEN', 'CLOSED', 'PRE_MARKET', 'AFTER_HOURS'],
    default: 'OPEN'
  },
  source: {
    type: String,
    default: 'NAV_ORACLE'
  }
}, {
  timestamps: true
});

// Compound indexes for performance
NAVPriceSchema.index({ fundId: 1, timestamp: -1 });
NAVPriceSchema.index({ fundSymbol: 1, timestamp: -1 });

const NAVPrice = mongoose.model('NAVPrice', NAVPriceSchema);

// Fund tracking for NAV updates
const FundTrackingSchema = new mongoose.Schema({
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true
  },
  fundSymbol: {
    type: String,
    required: true,
    unique: true
  },
  fundName: {
    type: String,
    required: true
  },
  currentNAV: {
    type: Number,
    required: true,
    min: 0
  },
  lastUpdateTime: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  volatility: {
    type: Number,
    default: 0.05 // 5% default volatility
  },
  trend: {
    type: Number,
    default: 0 // Neutral trend
  },
  tradingVolume: {
    type: Number,
    default: 0
  },
  totalSupply: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const FundTracking = mongoose.model('FundTracking', FundTrackingSchema);

// Start Kafka connections
connectProducer();
connectConsumer();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

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
          key: event.fundId || event.fundSymbol || uuidv4(), 
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`NAV event published to ${topic}:`, {
      fundSymbol: event.fundSymbol,
      price: event.price,
      changePercent: event.changePercent
    });
    return true;
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
    throw error;
  }
}

// Handle fund events to start tracking new funds
async function handleFundEvent(event) {
  try {
    if (event.eventType === 'FUND_CREATED' || event.eventType === 'FUND_APPROVED') {
      const fundData = event.fund || event;
      
      // Check if fund is already being tracked
      const existingTracking = await FundTracking.findOne({ fundId: fundData._id || fundData.fundId });
      
      if (!existingTracking) {
        const fundTracking = new FundTracking({
          fundId: fundData._id || fundData.fundId,
          fundSymbol: fundData.symbol,
          fundName: fundData.name,
          currentNAV: fundData.currentNAV || 100, // Default starting NAV
          isActive: true,
          volatility: getVolatilityByFundType(fundData.fundType),
          totalSupply: fundData.totalSupply || 0
        });
        
        await fundTracking.save();
        
        console.log(`Started tracking NAV for fund: ${fundData.symbol}`);
        
        // Publish initial NAV
        await publishInitialNAV(fundTracking);
      }
    }
  } catch (error) {
    console.error('Error handling fund event:', error);
  }
}

// Get volatility based on fund type
function getVolatilityByFundType(fundType) {
  const volatilities = {
    'hedge_fund': 0.08, // 8% volatility
    'private_equity': 0.03, // 3% volatility
    'real_estate': 0.02, // 2% volatility
    'other': 0.05 // 5% default
  };
  
  return volatilities[fundType] || volatilities['other'];
}

// Publish initial NAV for new fund
async function publishInitialNAV(fundTracking) {
  const navPrice = new NAVPrice({
    fundId: fundTracking.fundId,
    fundSymbol: fundTracking.fundSymbol,
    price: fundTracking.currentNAV,
    previousPrice: null,
    changeAmount: 0,
    changePercent: 0,
    volume: 0,
    marketCap: fundTracking.currentNAV * fundTracking.totalSupply
  });
  
  await navPrice.save();
  
  await publishEvent('nav-updates', {
    eventType: 'NAV_UPDATED',
    fundId: fundTracking.fundId.toString(),
    fundSymbol: fundTracking.fundSymbol,
    price: fundTracking.currentNAV,
    previousPrice: null,
    changeAmount: 0,
    changePercent: 0,
    marketCap: navPrice.marketCap,
    timestamp: new Date().toISOString()
  });
}

// Generate realistic NAV price movement
function generatePriceMovement(currentPrice, volatility, trend, marketStatus) {
  // Reduce volatility during closed market hours
  const adjustedVolatility = marketStatus === 'CLOSED' ? volatility * 0.3 : volatility;
  
  // Random walk with trend
  const randomComponent = (Math.random() - 0.5) * 2 * adjustedVolatility;
  const trendComponent = trend * 0.1; // Small trend influence
  
  // Calculate price change
  const priceChange = currentPrice * (randomComponent + trendComponent);
  
  // Apply maximum daily change limit
  const maxDailyChange = currentPrice * parseFloat(process.env.MAX_DAILY_CHANGE || '0.15');
  const boundedChange = Math.max(-maxDailyChange, Math.min(maxDailyChange, priceChange));
  
  const newPrice = Math.max(0.01, currentPrice + boundedChange); // Minimum price of 0.01
  
  return {
    newPrice: Math.round(newPrice * 100) / 100, // Round to 2 decimal places
    changeAmount: Math.round(boundedChange * 100) / 100,
    changePercent: Math.round((boundedChange / currentPrice) * 10000) / 100 // 2 decimal places
  };
}

// Determine market status (simplified)
function getMarketStatus() {
  if (process.env.MARKET_HOURS_ONLY === 'true') {
    const now = new Date();
    const hour = now.getHours();
    
    // Simple market hours: 9 AM to 4 PM
    if (hour >= 9 && hour < 16) {
      return 'OPEN';
    } else if (hour >= 7 && hour < 9) {
      return 'PRE_MARKET';
    } else if (hour >= 16 && hour < 20) {
      return 'AFTER_HOURS';
    } else {
      return 'CLOSED';
    }
  }
  
  return 'OPEN'; // Always open for demo purposes
}

// Update NAV prices for all tracked funds
async function updateAllNAVPrices() {
  try {
    const activeFunds = await FundTracking.find({ isActive: true });
    const marketStatus = getMarketStatus();
    
    console.log(`Updating NAV for ${activeFunds.length} funds (Market: ${marketStatus})`);
    
    const updatePromises = activeFunds.map(async (fund) => {
      try {
        const priceMovement = generatePriceMovement(
          fund.currentNAV,
          fund.volatility,
          fund.trend,
          marketStatus
        );
        
        // Create new NAV price record
        const navPrice = new NAVPrice({
          fundId: fund.fundId,
          fundSymbol: fund.fundSymbol,
          price: priceMovement.newPrice,
          previousPrice: fund.currentNAV,
          changeAmount: priceMovement.changeAmount,
          changePercent: priceMovement.changePercent,
          volume: Math.floor(Math.random() * 1000000), // Mock volume
          marketCap: priceMovement.newPrice * fund.totalSupply,
          marketStatus: marketStatus
        });
        
        await navPrice.save();
        
        // Update fund tracking record
        fund.currentNAV = priceMovement.newPrice;
        fund.lastUpdateTime = new Date();
        await fund.save();
        
        // Publish NAV update event
        await publishEvent('nav-updates', {
          eventType: 'NAV_UPDATED',
          fundId: fund.fundId.toString(),
          fundSymbol: fund.fundSymbol,
          price: priceMovement.newPrice,
          previousPrice: navPrice.previousPrice,
          changeAmount: priceMovement.changeAmount,
          changePercent: priceMovement.changePercent,
          volume: navPrice.volume,
          marketCap: navPrice.marketCap,
          marketStatus: marketStatus,
          timestamp: new Date().toISOString()
        });
        
        // Also notify fund service to update its records
        if (process.env.FUND_SERVICE_URL) {
          try {
            await axios.patch(`${process.env.FUND_SERVICE_URL}/api/funds/${fund.fundId}/nav`, {
              currentNAV: priceMovement.newPrice,
              lastUpdated: new Date().toISOString()
            });
          } catch (apiError) {
            console.warn(`Failed to update fund service for ${fund.fundSymbol}:`, apiError.message);
          }
        }
        
      } catch (error) {
        console.error(`Error updating NAV for fund ${fund.fundSymbol}:`, error);
      }
    });
    
    await Promise.all(updatePromises);
    
  } catch (error) {
    console.error('Error in NAV update process:', error);
  }
}

// Schedule NAV updates
const updateInterval = parseInt(process.env.NAV_UPDATE_INTERVAL_SECONDS || '10');
console.log(`Scheduling NAV updates every ${updateInterval} seconds`);

// Use cron for more precise scheduling
const cronExpression = `*/${updateInterval} * * * * *`; // Every N seconds
cron.schedule(cronExpression, updateAllNAVPrices);

// Initial NAV update on startup (after a short delay)
setTimeout(() => {
  updateAllNAVPrices();
}, 5000);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const activeFundsCount = await FundTracking.countDocuments({ isActive: true });
    const recentPricesCount = await NAVPrice.countDocuments({
      timestamp: { $gte: new Date(Date.now() - 60000) } // Last minute
    });
    
    res.status(200).json({
      status: 'ok',
      service: 'nav-oracle',
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      kafka: {
        producer: producerConnected ? 'connected' : 'disconnected',
        consumer: consumerConnected ? 'connected' : 'disconnected'
      },
      tracking: {
        activeFunds: activeFundsCount,
        recentUpdates: recentPricesCount,
        updateInterval: `${updateInterval} seconds`,
        marketStatus: getMarketStatus()
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'nav-oracle',
      error: error.message
    });
  }
});

// API ENDPOINTS

// 1. Get current NAV for all funds
app.get('/api/nav/current', async (req, res) => {
  try {
    const currentPrices = await FundTracking.find({ isActive: true })
      .select('fundId fundSymbol fundName currentNAV lastUpdateTime')
      .sort({ fundSymbol: 1 });
    
    res.status(200).json({
      message: 'Current NAV prices retrieved successfully',
      count: currentPrices.length,
      prices: currentPrices,
      marketStatus: getMarketStatus(),
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error retrieving current NAV:', error);
    res.status(500).json({
      message: 'Failed to retrieve current NAV',
      error: error.message
    });
  }
});

// 2. Get NAV history for a specific fund
app.get('/api/nav/:fundSymbol/history', async (req, res) => {
  try {
    const { fundSymbol } = req.params;
    const { 
      startDate, 
      endDate, 
      interval = '1m', // 1m, 5m, 1h, 1d
      limit = 100 
    } = req.query;
    
    const query = { fundSymbol: fundSymbol.toUpperCase() };
    
    if (startDate) {
      query.timestamp = { $gte: new Date(startDate) };
    }
    if (endDate) {
      query.timestamp = { ...query.timestamp, $lte: new Date(endDate) };
    }
    
    // For simplicity, we'll return all data points and let client handle intervals
    const history = await NAVPrice.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('price previousPrice changeAmount changePercent volume marketCap timestamp marketStatus');
    
    res.status(200).json({
      message: 'NAV history retrieved successfully',
      fundSymbol: fundSymbol.toUpperCase(),
      count: history.length,
      interval,
      history: history.reverse() // Return in chronological order
    });
  } catch (error) {
    console.error('Error retrieving NAV history:', error);
    res.status(500).json({
      message: 'Failed to retrieve NAV history',
      error: error.message
    });
  }
});

// 3. Get NAV statistics for a fund
app.get('/api/nav/:fundSymbol/stats', async (req, res) => {
  try {
    const { fundSymbol } = req.params;
    const { period = '1d' } = req.query; // 1d, 1w, 1m, 3m, 1y
    
    let startDate;
    const now = new Date();
    
    switch (period) {
      case '1d':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '1w':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '1m':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '3m':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    
    const prices = await NAVPrice.find({
      fundSymbol: fundSymbol.toUpperCase(),
      timestamp: { $gte: startDate }
    }).sort({ timestamp: 1 });
    
    if (prices.length === 0) {
      return res.status(404).json({
        message: 'No price data found for the specified period'
      });
    }
    
    const firstPrice = prices[0].price;
    const lastPrice = prices[prices.length - 1].price;
    const highPrice = Math.max(...prices.map(p => p.price));
    const lowPrice = Math.min(...prices.map(p => p.price));
    const totalVolume = prices.reduce((sum, p) => sum + p.volume, 0);
    const avgVolume = totalVolume / prices.length;
    
    // Calculate volatility (standard deviation of price changes)
    const priceChanges = prices.slice(1).map((p, i) => 
      (p.price - prices[i].price) / prices[i].price
    );
    const avgChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
    const variance = priceChanges.reduce((sum, change) => 
      sum + Math.pow(change - avgChange, 2), 0
    ) / priceChanges.length;
    const volatility = Math.sqrt(variance);
    
    const stats = {
      fundSymbol: fundSymbol.toUpperCase(),
      period,
      startDate,
      endDate: now,
      priceStats: {
        current: lastPrice,
        open: firstPrice,
        high: highPrice,
        low: lowPrice,
        change: lastPrice - firstPrice,
        changePercent: ((lastPrice - firstPrice) / firstPrice) * 100
      },
      volumeStats: {
        total: totalVolume,
        average: Math.round(avgVolume),
        high: Math.max(...prices.map(p => p.volume)),
        low: Math.min(...prices.map(p => p.volume))
      },
      riskMetrics: {
        volatility: volatility * 100, // Convert to percentage
        sharpeRatio: avgChange / volatility // Simplified Sharpe ratio
      },
      dataPoints: prices.length
    };
    
    res.status(200).json({
      message: 'NAV statistics retrieved successfully',
      stats
    });
  } catch (error) {
    console.error('Error retrieving NAV statistics:', error);
    res.status(500).json({
      message: 'Failed to retrieve NAV statistics',
      error: error.message
    });
  }
});

// 4. Add new fund for tracking (manual endpoint)
app.post('/api/nav/track', [
  body('fundId').isMongoId().withMessage('Valid fund ID required'),
  body('fundSymbol').isLength({ min: 2, max: 10 }).withMessage('Fund symbol must be 2-10 characters'),
  body('fundName').isLength({ min: 1, max: 100 }).withMessage('Fund name required'),
  body('currentNAV').isFloat({ min: 0.01 }).withMessage('Valid current NAV required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { fundId, fundSymbol, fundName, currentNAV, fundType = 'other' } = req.body;
    
    // Check if fund is already being tracked
    const existingTracking = await FundTracking.findOne({ 
      $or: [{ fundId }, { fundSymbol: fundSymbol.toUpperCase() }]
    });
    
    if (existingTracking) {
      return res.status(409).json({
        message: 'Fund is already being tracked'
      });
    }
    
    const fundTracking = new FundTracking({
      fundId,
      fundSymbol: fundSymbol.toUpperCase(),
      fundName,
      currentNAV,
      isActive: true,
      volatility: getVolatilityByFundType(fundType)
    });
    
    await fundTracking.save();
    
    // Publish initial NAV
    await publishInitialNAV(fundTracking);
    
    res.status(201).json({
      message: 'Fund tracking started successfully',
      fundTracking
    });
  } catch (error) {
    console.error('Error starting fund tracking:', error);
    res.status(500).json({
      message: 'Failed to start fund tracking',
      error: error.message
    });
  }
});

// 5. Stop tracking a fund
app.delete('/api/nav/track/:fundSymbol', async (req, res) => {
  try {
    const { fundSymbol } = req.params;
    
    const fundTracking = await FundTracking.findOne({ 
      fundSymbol: fundSymbol.toUpperCase() 
    });
    
    if (!fundTracking) {
      return res.status(404).json({
        message: 'Fund not found in tracking list'
      });
    }
    
    fundTracking.isActive = false;
    await fundTracking.save();
    
    res.status(200).json({
      message: 'Fund tracking stopped successfully',
      fundSymbol: fundSymbol.toUpperCase()
    });
  } catch (error) {
    console.error('Error stopping fund tracking:', error);
    res.status(500).json({
      message: 'Failed to stop fund tracking',
      error: error.message
    });
  }
});

// Server setup
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`NAV Oracle service running on port ${PORT}`);
    console.log(`NAV updates scheduled every ${updateInterval} seconds`);
  });
}

module.exports = { app, server };
