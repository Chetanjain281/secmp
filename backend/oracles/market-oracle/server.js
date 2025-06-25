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
const PORT = process.env.PORT || 3024;

// Kafka setup
const kafka = new Kafka({
  clientId: 'market-oracle',
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

// Market Data Schema
const MarketDataSchema = new mongoose.Schema({
  fundId: {
    type: String,
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true
  },
  currentPrice: {
    type: Number,
    required: true
  },
  bidPrice: {
    type: Number,
    required: true
  },
  askPrice: {
    type: Number,
    required: true
  },
  spread: {
    type: Number,
    required: true
  },
  volume24h: {
    type: Number,
    default: 0
  },
  volumeUSD24h: {
    type: Number,
    default: 0
  },
  priceChange24h: {
    type: Number,
    default: 0
  },
  priceChangePercent24h: {
    type: Number,
    default: 0
  },
  high24h: {
    type: Number,
    required: true
  },
  low24h: {
    type: Number,
    required: true
  },
  marketCap: {
    type: Number,
    default: 0
  },
  totalSupply: {
    type: Number,
    default: 0
  },
  circulatingSupply: {
    type: Number,
    default: 0
  },
  activeListings: {
    type: Number,
    default: 0
  },
  totalTrades: {
    type: Number,
    default: 0
  },
  avgTradeSize: {
    type: Number,
    default: 0
  },
  liquidityScore: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.5
  },
  volatilityIndex: {
    type: Number,
    default: 0.02
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Price History Schema
const PriceHistorySchema = new mongoose.Schema({
  fundId: {
    type: String,
    required: true,
    index: true
  },
  price: {
    type: Number,
    required: true
  },
  volume: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  source: {
    type: String,
    enum: ['oracle', 'trade', 'nav', 'manual'],
    default: 'oracle'
  }
});

// Trading Volume Analytics Schema
const VolumeAnalyticsSchema = new mongoose.Schema({
  fundId: {
    type: String,
    required: true,
    index: true
  },
  timeframe: {
    type: String,
    enum: ['1h', '24h', '7d', '30d'],
    required: true
  },
  totalVolume: {
    type: Number,
    default: 0
  },
  totalVolumeUSD: {
    type: Number,
    default: 0
  },
  tradeCount: {
    type: Number,
    default: 0
  },
  uniqueTraders: {
    type: Number,
    default: 0
  },
  avgTradeSize: {
    type: Number,
    default: 0
  },
  priceVolatility: {
    type: Number,
    default: 0
  },
  period: {
    start: { type: Date, required: true },
    end: { type: Date, required: true }
  }
}, {
  timestamps: true
});

// Indexes for performance
MarketDataSchema.index({ fundId: 1, lastUpdated: -1 });
PriceHistorySchema.index({ fundId: 1, timestamp: -1 });
VolumeAnalyticsSchema.index({ fundId: 1, timeframe: 1, 'period.start': -1 });

const MarketData = mongoose.model('MarketData', MarketDataSchema);
const PriceHistory = mongoose.model('PriceHistory', PriceHistorySchema);
const VolumeAnalytics = mongoose.model('VolumeAnalytics', VolumeAnalyticsSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'market-oracle',
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
          key: event.fundId || uuidv4(), 
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Event published to ${topic}:`, event.eventType);
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
  }
}

// Market data simulation helpers
function generateRandomChange(baseValue, volatility) {
  const change = (Math.random() - 0.5) * 2 * volatility;
  return baseValue * (1 + change);
}

function calculateSpread(price, baseSpread = 0.005) {
  const spreadRange = parseFloat(process.env.SPREAD_RANGE) || 0.005;
  const randomSpread = baseSpread + (Math.random() * spreadRange);
  return price * randomSpread;
}

function generateVolumeData(baseVolume, volatility = 0.15) {
  const volumeVolatility = parseFloat(process.env.VOLUME_VOLATILITY) || volatility;
  return Math.max(0, generateRandomChange(baseVolume, volumeVolatility));
}

// Get active funds from fund service
async function getActiveFunds() {
  try {
    const fundServiceUrl = process.env.FUND_SERVICE_URL || 'http://localhost:3013';
    const response = await axios.get(`${fundServiceUrl}/api/funds`, {
      timeout: 5000
    });
    return response.data.funds || [];
  } catch (error) {
    console.error('Error fetching funds:', error.message);
    return [];
  }
}

// Update market data for all funds
async function updateMarketData() {
  try {
    console.log('Starting market data update...');
    
    const funds = await getActiveFunds();
    if (funds.length === 0) {
      console.log('No active funds found for market data update');
      return;
    }
    
    const updatePromises = funds.map(async (fund) => {
      try {
        // Get existing market data or create new
        let marketData = await MarketData.findOne({ fundId: fund.fundId });
        
        if (!marketData) {
          // Initialize new market data
          marketData = new MarketData({
            fundId: fund.fundId,
            symbol: fund.symbol || (fund.fundName ? fund.fundName.replace(/\s+/g, '').toUpperCase() : 'UNKNOWN'),
            currentPrice: fund.currentNAV || 100,
            bidPrice: fund.currentNAV * 0.99 || 99,
            askPrice: fund.currentNAV * 1.01 || 101,
            spread: 2,
            high24h: fund.currentNAV || 100,
            low24h: fund.currentNAV || 100,
            totalSupply: fund.totalTokens || 0,
            circulatingSupply: fund.circulatingTokens || 0
          });
        }
        
        // Calculate new prices based on current price
        const priceVolatility = parseFloat(process.env.PRICE_VOLATILITY) || 0.02;
        const newPrice = generateRandomChange(marketData.currentPrice, priceVolatility);
        const spread = calculateSpread(newPrice);
        
        // Generate volume data
        const baseVolume = marketData.volume24h || 1000;
        const newVolume = generateVolumeData(baseVolume);
        const volumeUSD = newVolume * newPrice;
        
        // Calculate price changes
        const priceChange24h = newPrice - marketData.currentPrice;
        const priceChangePercent24h = (priceChange24h / marketData.currentPrice) * 100;
        
        // Update 24h high/low
        const high24h = Math.max(marketData.high24h, newPrice);
        const low24h = Math.min(marketData.low24h, newPrice);
        
        // Calculate market cap
        const marketCap = newPrice * (marketData.circulatingSupply || 0);
        
        // Update market data
        marketData.currentPrice = newPrice;
        marketData.bidPrice = newPrice - (spread / 2);
        marketData.askPrice = newPrice + (spread / 2);
        marketData.spread = spread;
        marketData.volume24h = newVolume;
        marketData.volumeUSD24h = volumeUSD;
        marketData.priceChange24h = priceChange24h;
        marketData.priceChangePercent24h = priceChangePercent24h;
        marketData.high24h = high24h;
        marketData.low24h = low24h;
        marketData.marketCap = marketCap;
        marketData.lastUpdated = new Date();
        
        // Calculate volatility index (simplified)
        marketData.volatilityIndex = Math.abs(priceChangePercent24h) / 100;
        
        // Save market data
        await marketData.save();
        
        // Save price history
        const priceHistory = new PriceHistory({
          fundId: fund.fundId,
          price: newPrice,
          volume: newVolume,
          timestamp: new Date(),
          source: 'oracle'
        });
        await priceHistory.save();
        
        // Publish market update event
        await publishEvent('market-events', {
          eventType: 'MARKET_DATA_UPDATED',
          fundId: fund.fundId,
          symbol: marketData.symbol,
          currentPrice: newPrice,
          priceChange24h: priceChange24h,
          priceChangePercent24h: priceChangePercent24h,
          volume24h: newVolume,
          volumeUSD24h: volumeUSD,
          spread: spread,
          marketCap: marketCap,
          timestamp: new Date().toISOString()
        });
        
        return marketData;
        
      } catch (error) {
        console.error(`Error updating market data for fund ${fund.fundId}:`, error);
        return null;
      }
    });
    
    const results = await Promise.all(updatePromises);
    const successCount = results.filter(result => result !== null).length;
    console.log(`Updated market data for ${successCount}/${funds.length} funds`);
    
  } catch (error) {
    console.error('Error in market data update:', error);
  }
}

// Calculate volume analytics
async function calculateVolumeAnalytics() {
  try {
    const timeframes = [
      { name: '1h', duration: 60 * 60 * 1000 },
      { name: '24h', duration: 24 * 60 * 60 * 1000 },
      { name: '7d', duration: 7 * 24 * 60 * 60 * 1000 },
      { name: '30d', duration: 30 * 24 * 60 * 60 * 1000 }
    ];
    
    const funds = await MarketData.distinct('fundId');
    
    for (const fundId of funds) {
      for (const timeframe of timeframes) {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timeframe.duration);
        
        // Get price history for the timeframe
        const priceHistory = await PriceHistory.find({
          fundId,
          timestamp: { $gte: startTime, $lte: endTime }
        }).sort({ timestamp: 1 });
        
        if (priceHistory.length === 0) continue;
        
        // Calculate analytics
        const totalVolume = priceHistory.reduce((sum, record) => sum + record.volume, 0);
        const avgPrice = priceHistory.reduce((sum, record) => sum + record.price, 0) / priceHistory.length;
        const totalVolumeUSD = totalVolume * avgPrice;
        const tradeCount = priceHistory.length;
        const avgTradeSize = totalVolume / tradeCount;
        
        // Calculate price volatility
        const prices = priceHistory.map(record => record.price);
        const priceChanges = prices.slice(1).map((price, i) => Math.abs((price - prices[i]) / prices[i]));
        const priceVolatility = priceChanges.length > 0 
          ? priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length 
          : 0;
        
        // Upsert volume analytics
        await VolumeAnalytics.findOneAndUpdate(
          { 
            fundId, 
            timeframe: timeframe.name,
            'period.start': { $gte: startTime },
            'period.end': { $lte: endTime }
          },
          {
            $set: {
              totalVolume,
              totalVolumeUSD,
              tradeCount,
              avgTradeSize,
              priceVolatility,
              period: { start: startTime, end: endTime }
            }
          },
          { upsert: true, new: true }
        );
      }
    }
    
    console.log('Volume analytics calculated successfully');
    
  } catch (error) {
    console.error('Error calculating volume analytics:', error);
  }
}

// Setup periodic market data updates
const updateInterval = parseInt(process.env.MARKET_UPDATE_INTERVAL_SECONDS) || 30;
console.log(`Setting up market oracle updates every ${updateInterval} second(s)`);

// Schedule market data updates
cron.schedule(`*/${updateInterval} * * * * *`, updateMarketData);

// Schedule volume analytics calculation (every 5 minutes)
cron.schedule('*/5 * * * *', calculateVolumeAnalytics);

// API ENDPOINTS

// 1. Get market data for a fund
app.get('/api/market/:fundId', async (req, res) => {
  try {
    const { fundId } = req.params;
    
    const marketData = await MarketData.findOne({ fundId });
    if (!marketData) {
      return res.status(404).json({
        message: 'Market data not found',
        fundId
      });
    }
    
    res.status(200).json({
      fundId: marketData.fundId,
      symbol: marketData.symbol,
      currentPrice: marketData.currentPrice,
      bidPrice: marketData.bidPrice,
      askPrice: marketData.askPrice,
      spread: marketData.spread,
      volume24h: marketData.volume24h,
      volumeUSD24h: marketData.volumeUSD24h,
      priceChange24h: marketData.priceChange24h,
      priceChangePercent24h: marketData.priceChangePercent24h,
      high24h: marketData.high24h,
      low24h: marketData.low24h,
      marketCap: marketData.marketCap,
      liquidityScore: marketData.liquidityScore,
      volatilityIndex: marketData.volatilityIndex,
      lastUpdated: marketData.lastUpdated
    });
    
  } catch (error) {
    console.error('Market data retrieval error:', error);
    res.status(500).json({
      message: 'Market data retrieval failed',
      error: error.message
    });
  }
});

// 2. Get price history for a fund
app.get('/api/market/:fundId/history', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { timeframe = '24h', limit = 100 } = req.query;
    
    // Calculate start time based on timeframe
    const timeframeDurations = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    const duration = timeframeDurations[timeframe] || timeframeDurations['24h'];
    const startTime = new Date(Date.now() - duration);
    
    const priceHistory = await PriceHistory.find({
      fundId,
      timestamp: { $gte: startTime }
    })
    .sort({ timestamp: -1 })
    .limit(parseInt(limit));
    
    res.status(200).json({
      fundId,
      timeframe,
      dataPoints: priceHistory.length,
      priceHistory: priceHistory.reverse() // Return in chronological order
    });
    
  } catch (error) {
    console.error('Price history retrieval error:', error);
    res.status(500).json({
      message: 'Price history retrieval failed',
      error: error.message
    });
  }
});

// 3. Get volume analytics
app.get('/api/analytics/:fundId/volume', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { timeframe } = req.query;
    
    let query = { fundId };
    if (timeframe) {
      query.timeframe = timeframe;
    }
    
    const analytics = await VolumeAnalytics.find(query)
      .sort({ 'period.start': -1 })
      .limit(timeframe ? 1 : 10);
    
    res.status(200).json({
      fundId,
      analytics
    });
    
  } catch (error) {
    console.error('Volume analytics retrieval error:', error);
    res.status(500).json({
      message: 'Volume analytics retrieval failed',
      error: error.message
    });
  }
});

// 4. Get all market data
app.get('/api/market', async (req, res) => {
  try {
    const { sortBy = 'volume24h', order = 'desc', limit = 50 } = req.query;
    
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder;
    
    const marketData = await MarketData.find({})
      .sort(sortOptions)
      .limit(parseInt(limit))
      .select('-__v');
    
    res.status(200).json({
      totalFunds: marketData.length,
      sortBy,
      order,
      marketData
    });
    
  } catch (error) {
    console.error('Market data list retrieval error:', error);
    res.status(500).json({
      message: 'Market data list retrieval failed',
      error: error.message
    });
  }
});

// 5. Get market analytics summary
app.get('/api/analytics/market', async (req, res) => {
  try {
    const totalFunds = await MarketData.countDocuments();
    
    const marketStats = await MarketData.aggregate([
      {
        $group: {
          _id: null,
          totalMarketCap: { $sum: '$marketCap' },
          totalVolume24h: { $sum: '$volume24h' },
          totalVolumeUSD24h: { $sum: '$volumeUSD24h' },
          avgPrice: { $avg: '$currentPrice' },
          avgVolatility: { $avg: '$volatilityIndex' },
          maxPrice: { $max: '$currentPrice' },
          minPrice: { $min: '$currentPrice' }
        }
      }
    ]);
    
    const topGainers = await MarketData.find({ priceChangePercent24h: { $gt: 0 } })
      .sort({ priceChangePercent24h: -1 })
      .limit(5)
      .select('fundId symbol currentPrice priceChangePercent24h volume24h');
    
    const topLosers = await MarketData.find({ priceChangePercent24h: { $lt: 0 } })
      .sort({ priceChangePercent24h: 1 })
      .limit(5)
      .select('fundId symbol currentPrice priceChangePercent24h volume24h');
    
    const topVolume = await MarketData.find({})
      .sort({ volumeUSD24h: -1 })
      .limit(5)
      .select('fundId symbol currentPrice volumeUSD24h volume24h');
    
    res.status(200).json({
      summary: {
        totalFunds,
        ...marketStats[0]
      },
      topGainers,
      topLosers,
      topVolume,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Market analytics error:', error);
    res.status(500).json({
      message: 'Market analytics retrieval failed',
      error: error.message
    });
  }
});

// 6. Force market data update for a specific fund
app.post('/api/market/:fundId/update', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { price, volume } = req.body;
    
    let marketData = await MarketData.findOne({ fundId });
    if (!marketData) {
      return res.status(404).json({
        message: 'Market data not found',
        fundId
      });
    }
    
    if (price) {
      const oldPrice = marketData.currentPrice;
      const spread = calculateSpread(price);
      
      marketData.currentPrice = price;
      marketData.bidPrice = price - (spread / 2);
      marketData.askPrice = price + (spread / 2);
      marketData.spread = spread;
      marketData.priceChange24h = price - oldPrice;
      marketData.priceChangePercent24h = ((price - oldPrice) / oldPrice) * 100;
      marketData.high24h = Math.max(marketData.high24h, price);
      marketData.low24h = Math.min(marketData.low24h, price);
      marketData.lastUpdated = new Date();
    }
    
    if (volume) {
      marketData.volume24h = volume;
      marketData.volumeUSD24h = volume * marketData.currentPrice;
    }
    
    await marketData.save();
    
    // Save price history
    if (price) {
      const priceHistory = new PriceHistory({
        fundId,
        price,
        volume: volume || marketData.volume24h,
        timestamp: new Date(),
        source: 'manual'
      });
      await priceHistory.save();
    }
    
    // Publish update event
    await publishEvent('market-events', {
      eventType: 'MARKET_DATA_MANUAL_UPDATE',
      fundId,
      symbol: marketData.symbol,
      currentPrice: marketData.currentPrice,
      volume24h: marketData.volume24h,
      source: 'manual',
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      message: 'Market data updated successfully',
      marketData
    });
    
  } catch (error) {
    console.error('Market data update error:', error);
    res.status(500).json({
      message: 'Market data update failed',
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
  console.log('Shutting down market oracle gracefully...');
  if (producerConnected) {
    await producer.disconnect();
  }
  await mongoose.connection.close();
  process.exit(0);
});

const server = process.env.NODE_ENV === 'test' ? null : app.listen(PORT, () => {
  console.log(`Market Oracle running on port ${PORT}`);
  console.log(`Update interval: ${updateInterval} second(s)`);
});

module.exports = { app, server };
