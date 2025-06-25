const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3022;

// Kafka setup
const kafka = new Kafka({
  clientId: 'forex-oracle',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
let producerConnected = false;

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

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Forex Rate Schema
const ForexRateSchema = new mongoose.Schema({
  baseCurrency: {
    type: String,
    required: true,
    default: 'INR'
  },
  targetCurrency: {
    type: String,
    required: true,
    default: 'USD'
  },
  rate: {
    type: Number,
    required: true,
    min: 0
  },
  previousRate: {
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
  bid: {
    type: Number,
    required: true
  },
  ask: {
    type: Number,
    required: true
  },
  spread: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  marketStatus: {
    type: String,
    enum: ['OPEN', 'CLOSED'],
    default: 'OPEN'
  },
  source: {
    type: String,
    default: 'FOREX_ORACLE'
  }
}, {
  timestamps: true
});

ForexRateSchema.index({ baseCurrency: 1, targetCurrency: 1, timestamp: -1 });

const ForexRate = mongoose.model('ForexRate', ForexRateSchema);

// Start Kafka connections
connectProducer();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Current forex state
let currentRate = parseFloat(process.env.BASE_INR_USD_RATE || '83.25');

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
          key: `${event.baseCurrency}_${event.targetCurrency}`, 
          value: JSON.stringify(event)
        }
      ]
    });
    console.log(`Forex rate published to ${topic}:`, {
      rate: event.rate,
      changePercent: event.changePercent
    });
    return true;
  } catch (error) {
    console.error(`Error publishing to ${topic}:`, error);
    throw error;
  }
}

// Generate realistic forex rate movement
function generateForexMovement(currentRate, volatility, marketStatus) {
  // Reduce volatility during closed market hours
  const adjustedVolatility = marketStatus === 'CLOSED' ? volatility * 0.3 : volatility;
  
  // Random walk
  const randomComponent = (Math.random() - 0.5) * 2 * adjustedVolatility;
  
  // Calculate rate change
  const rateChange = currentRate * randomComponent;
  
  // Apply maximum daily change limit
  const maxDailyChange = currentRate * parseFloat(process.env.MAX_DAILY_CHANGE || '0.05');
  const boundedChange = Math.max(-maxDailyChange, Math.min(maxDailyChange, rateChange));
  
  const newRate = Math.max(1, currentRate + boundedChange); // Minimum rate of 1
  
  // Calculate bid-ask spread (typically 0.1-0.5% for major currencies)
  const spreadPercent = 0.002; // 0.2%
  const spread = newRate * spreadPercent;
  const bid = newRate - (spread / 2);
  const ask = newRate + (spread / 2);
  
  return {
    newRate: Math.round(newRate * 10000) / 10000, // Round to 4 decimal places
    changeAmount: Math.round(boundedChange * 10000) / 10000,
    changePercent: Math.round((boundedChange / currentRate) * 10000) / 100,
    bid: Math.round(bid * 10000) / 10000,
    ask: Math.round(ask * 10000) / 10000,
    spread: Math.round(spread * 10000) / 10000
  };
}

// Determine market status
function getMarketStatus() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Forex market is generally open 24/5 (Monday to Friday)
  if (day === 0 || day === 6) { // Weekend
    return 'CLOSED';
  }
  
  // For simplicity, consider market always open on weekdays
  return 'OPEN';
}

// Update forex rates
async function updateForexRates() {
  try {
    const marketStatus = getMarketStatus();
    const volatility = parseFloat(process.env.FOREX_VOLATILITY || '0.02');
    
    const rateMovement = generateForexMovement(currentRate, volatility, marketStatus);
    
    // Create new forex rate record
    const forexRate = new ForexRate({
      baseCurrency: 'INR',
      targetCurrency: 'USD',
      rate: rateMovement.newRate,
      previousRate: currentRate,
      changeAmount: rateMovement.changeAmount,
      changePercent: rateMovement.changePercent,
      bid: rateMovement.bid,
      ask: rateMovement.ask,
      spread: rateMovement.spread,
      marketStatus: marketStatus
    });
    
    await forexRate.save();
    
    // Update current rate
    currentRate = rateMovement.newRate;
    
    // Publish forex update event
    await publishEvent('forex-updates', {
      eventType: 'FOREX_RATE_UPDATED',
      baseCurrency: 'INR',
      targetCurrency: 'USD',
      rate: rateMovement.newRate,
      previousRate: forexRate.previousRate,
      changeAmount: rateMovement.changeAmount,
      changePercent: rateMovement.changePercent,
      bid: rateMovement.bid,
      ask: rateMovement.ask,
      spread: rateMovement.spread,
      marketStatus: marketStatus,
      timestamp: new Date().toISOString()
    });
    
    console.log(`Forex rate updated: 1 INR = ${rateMovement.newRate} USD (${rateMovement.changePercent > 0 ? '+' : ''}${rateMovement.changePercent}%)`);
    
  } catch (error) {
    console.error('Error updating forex rates:', error);
  }
}

// Schedule forex updates
const updateInterval = parseInt(process.env.FOREX_UPDATE_INTERVAL_SECONDS || '30');
console.log(`Scheduling forex updates every ${updateInterval} seconds`);

const cronExpression = `*/${updateInterval} * * * * *`; // Every N seconds
cron.schedule(cronExpression, updateForexRates);

// Initial update on startup
setTimeout(() => {
  updateForexRates();
}, 3000);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const recentRatesCount = await ForexRate.countDocuments({
      timestamp: { $gte: new Date(Date.now() - 120000) } // Last 2 minutes
    });
    
    res.status(200).json({
      status: 'ok',
      service: 'forex-oracle',
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      kafka: {
        producer: producerConnected ? 'connected' : 'disconnected'
      },
      forex: {
        currentRate: currentRate,
        recentUpdates: recentRatesCount,
        updateInterval: `${updateInterval} seconds`,
        marketStatus: getMarketStatus()
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'forex-oracle',
      error: error.message
    });
  }
});

// API ENDPOINTS

// 1. Get current forex rate
app.get('/api/forex/current', async (req, res) => {
  try {
    const { baseCurrency = 'INR', targetCurrency = 'USD' } = req.query;
    
    const currentForexRate = await ForexRate.findOne({
      baseCurrency: baseCurrency.toUpperCase(),
      targetCurrency: targetCurrency.toUpperCase()
    }).sort({ timestamp: -1 });
    
    if (!currentForexRate) {
      return res.status(404).json({
        message: 'No forex rate found for the specified currency pair'
      });
    }
    
    res.status(200).json({
      message: 'Current forex rate retrieved successfully',
      rate: currentForexRate,
      marketStatus: getMarketStatus(),
      lastUpdate: currentForexRate.timestamp
    });
  } catch (error) {
    console.error('Error retrieving current forex rate:', error);
    res.status(500).json({
      message: 'Failed to retrieve current forex rate',
      error: error.message
    });
  }
});

// 2. Get forex rate history
app.get('/api/forex/history', async (req, res) => {
  try {
    const { 
      baseCurrency = 'INR',
      targetCurrency = 'USD',
      startDate, 
      endDate, 
      limit = 100 
    } = req.query;
    
    const query = { 
      baseCurrency: baseCurrency.toUpperCase(),
      targetCurrency: targetCurrency.toUpperCase()
    };
    
    if (startDate) {
      query.timestamp = { $gte: new Date(startDate) };
    }
    if (endDate) {
      query.timestamp = { ...query.timestamp, $lte: new Date(endDate) };
    }
    
    const history = await ForexRate.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('rate previousRate changeAmount changePercent bid ask spread timestamp marketStatus');
    
    res.status(200).json({
      message: 'Forex rate history retrieved successfully',
      currencyPair: `${baseCurrency.toUpperCase()}/${targetCurrency.toUpperCase()}`,
      count: history.length,
      history: history.reverse() // Return in chronological order
    });
  } catch (error) {
    console.error('Error retrieving forex history:', error);
    res.status(500).json({
      message: 'Failed to retrieve forex history',
      error: error.message
    });
  }
});

// 3. Convert currency amount
app.get('/api/forex/convert', async (req, res) => {
  try {
    const { 
      amount,
      fromCurrency = 'INR',
      toCurrency = 'USD',
      useSpread = false
    } = req.query;
    
    if (!amount || isNaN(amount)) {
      return res.status(400).json({
        message: 'Valid amount is required'
      });
    }
    
    const currentForexRate = await ForexRate.findOne({
      baseCurrency: fromCurrency.toUpperCase(),
      targetCurrency: toCurrency.toUpperCase()
    }).sort({ timestamp: -1 });
    
    if (!currentForexRate) {
      return res.status(404).json({
        message: 'No forex rate found for the specified currency pair'
      });
    }
    
    const inputAmount = parseFloat(amount);
    let conversionRate = currentForexRate.rate;
    
    // Use bid/ask rates if spread is requested
    if (useSpread) {
      // If converting from base to target currency, use ask rate (buying target currency)
      // If converting from target to base currency, use bid rate (selling target currency)
      conversionRate = fromCurrency.toUpperCase() === currentForexRate.baseCurrency ? 
        currentForexRate.ask : currentForexRate.bid;
    }
    
    const convertedAmount = fromCurrency.toUpperCase() === currentForexRate.baseCurrency ?
      inputAmount / conversionRate : inputAmount * conversionRate;
    
    res.status(200).json({
      message: 'Currency conversion completed successfully',
      conversion: {
        inputAmount: inputAmount,
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        exchangeRate: conversionRate,
        convertedAmount: Math.round(convertedAmount * 100) / 100,
        spreadApplied: useSpread,
        timestamp: currentForexRate.timestamp
      }
    });
  } catch (error) {
    console.error('Error converting currency:', error);
    res.status(500).json({
      message: 'Failed to convert currency',
      error: error.message
    });
  }
});

// 4. Get forex statistics
app.get('/api/forex/stats', async (req, res) => {
  try {
    const { 
      baseCurrency = 'INR',
      targetCurrency = 'USD',
      period = '1d' 
    } = req.query;
    
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
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    
    const rates = await ForexRate.find({
      baseCurrency: baseCurrency.toUpperCase(),
      targetCurrency: targetCurrency.toUpperCase(),
      timestamp: { $gte: startDate }
    }).sort({ timestamp: 1 });
    
    if (rates.length === 0) {
      return res.status(404).json({
        message: 'No rate data found for the specified period'
      });
    }
    
    const firstRate = rates[0].rate;
    const lastRate = rates[rates.length - 1].rate;
    const highRate = Math.max(...rates.map(r => r.rate));
    const lowRate = Math.min(...rates.map(r => r.rate));
    const avgSpread = rates.reduce((sum, r) => sum + r.spread, 0) / rates.length;
    
    // Calculate volatility
    const rateChanges = rates.slice(1).map((r, i) => 
      (r.rate - rates[i].rate) / rates[i].rate
    );
    const avgChange = rateChanges.reduce((sum, change) => sum + change, 0) / rateChanges.length;
    const variance = rateChanges.reduce((sum, change) => 
      sum + Math.pow(change - avgChange, 2), 0
    ) / rateChanges.length;
    const volatility = Math.sqrt(variance);
    
    const stats = {
      currencyPair: `${baseCurrency.toUpperCase()}/${targetCurrency.toUpperCase()}`,
      period,
      startDate,
      endDate: now,
      rateStats: {
        current: lastRate,
        open: firstRate,
        high: highRate,
        low: lowRate,
        change: lastRate - firstRate,
        changePercent: ((lastRate - firstRate) / firstRate) * 100
      },
      spreadStats: {
        average: Math.round(avgSpread * 10000) / 10000,
        high: Math.max(...rates.map(r => r.spread)),
        low: Math.min(...rates.map(r => r.spread))
      },
      volatility: volatility * 100, // Convert to percentage
      dataPoints: rates.length
    };
    
    res.status(200).json({
      message: 'Forex statistics retrieved successfully',
      stats
    });
  } catch (error) {
    console.error('Error retrieving forex statistics:', error);
    res.status(500).json({
      message: 'Failed to retrieve forex statistics',
      error: error.message
    });
  }
});

// Server setup
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Forex Oracle service running on port ${PORT}`);
    console.log(`Forex updates scheduled every ${updateInterval} seconds`);
    console.log(`Current INR/USD rate: ${currentRate}`);
  });
}

module.exports = { app, server };
