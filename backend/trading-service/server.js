const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3014;

// Kafka setup
const kafka = new Kafka({
  clientId: 'trading-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'trading-service-group' });
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
    
    // Subscribe to relevant topics
    await consumer.subscribe({ topics: ['fund-events', 'order-events', 'user-events'], fromBeginning: false });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const eventData = JSON.parse(message.value.toString());
        console.log(`Received event from ${topic}:`, eventData);
        
        // Process events based on topic and type
        switch(topic) {
          case 'fund-events':
            await handleFundEvent(eventData);
            break;
          case 'order-events':
            await handleOrderEvent(eventData);
            break;
          case 'user-events':
            await handleUserEvent(eventData);
            break;
        }
      },
    });
    
    consumerConnected = true;
  } catch (error) {
    console.error('Error connecting to Kafka consumer:', error);
    setTimeout(connectConsumer, 5000);
  }
}

// Start Kafka connections
connectProducer();
connectConsumer();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Order Schema
const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  orderType: {
    type: String,
    required: true,
    enum: ['BUY', 'SELL']
  },
  marketType: {
    type: String,
    required: true,
    enum: ['PRIMARY', 'SECONDARY']
  },
  tokenAmount: {
    type: Number,
    required: true,
    min: 0
  },
  pricePerToken: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED'],
    default: 'PENDING'
  },
  filledAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  remainingAmount: {
    type: Number,
    min: 0
  },
  lockedTokens: {
    type: Number,
    default: 0,
    min: 0
  },
  walletAddress: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid Ethereum address format'
    }
  },
  txHash: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
OrderSchema.index({ userId: 1 });
OrderSchema.index({ fundId: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ orderType: 1, marketType: 1, status: 1 });
OrderSchema.index({ createdAt: -1 });

const Order = mongoose.model('Order', OrderSchema);

// Trade Schema
const TradeSchema = new mongoose.Schema({
  buyOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  sellOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  tokenAmount: {
    type: Number,
    required: true,
    min: 0
  },
  pricePerToken: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'SETTLED', 'FAILED'],
    default: 'PENDING'
  },
  settlementTxHash: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  settledAt: {
    type: Date,
    default: null
  }
});

// Indexes for performance
TradeSchema.index({ buyerId: 1 });
TradeSchema.index({ sellerId: 1 });
TradeSchema.index({ fundId: 1 });
TradeSchema.index({ status: 1 });
TradeSchema.index({ createdAt: -1 });

const Trade = mongoose.model('Trade', TradeSchema);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Kafka event handling functions
async function handleFundEvent(event) {
  try {
    switch(event.eventType) {
      case 'FUND_PAUSED':
        // Cancel all pending orders for this fund
        await Order.updateMany(
          { fundId: event.fundId, status: 'PENDING' },
          { status: 'CANCELLED', updatedAt: new Date() }
        );
        break;
      
      default:
        // No action needed for other event types
        break;
    }
  } catch (error) {
    console.error('Error handling fund event:', error);
  }
}

async function handleOrderEvent(event) {
  try {
    switch(event.eventType) {
      case 'ORDER_CREATED':
        // Try to match the order
        if (event.orderType === 'BUY') {
          await matchBuyOrder(event.orderId);
        } else if (event.orderType === 'SELL') {
          await matchSellOrder(event.orderId);
        }
        break;
      
      default:
        // No action needed for other event types
        break;
    }
  } catch (error) {
    console.error('Error handling order event:', error);
  }
}

async function handleUserEvent(event) {
  // Process user events if needed
}

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
          key: event.orderId || event.tradeId || uuidv4(), 
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
const validateOrderCreation = [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('fundId').notEmpty().withMessage('Fund ID is required'),
  body('orderType').isIn(['BUY', 'SELL']).withMessage('Order type must be BUY or SELL'),
  body('marketType').isIn(['PRIMARY', 'SECONDARY']).withMessage('Market type must be PRIMARY or SECONDARY'),
  body('tokenAmount').isFloat({ min: 0 }).withMessage('Token amount must be greater than 0'),
  body('pricePerToken').isFloat({ min: 0 }).withMessage('Price per token must be greater than 0'),
  body('walletAddress').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid wallet address')
];

// Order matching functions
async function matchBuyOrder(orderId) {
  try {
    const buyOrder = await Order.findById(orderId);
    if (!buyOrder || buyOrder.status !== 'PENDING') return;

    // Find matching sell orders (price <= buy order price, same fund, PENDING status)
    const matchingSellOrders = await Order.find({
      fundId: buyOrder.fundId,
      orderType: 'SELL',
      marketType: buyOrder.marketType,
      status: { $in: ['PENDING', 'PARTIAL'] },
      pricePerToken: { $lte: buyOrder.pricePerToken }
    }).sort({ pricePerToken: 1, createdAt: 1 }); // Lowest price first, then oldest

    let remainingAmount = buyOrder.tokenAmount;
    
    for (const sellOrder of matchingSellOrders) {
      if (remainingAmount <= 0) break;
      
      const matchAmount = Math.min(remainingAmount, sellOrder.remainingAmount);
      const matchPrice = sellOrder.pricePerToken; // Use the sell order's price
      
      // Create a trade
      const trade = new Trade({
        buyOrderId: buyOrder._id,
        sellOrderId: sellOrder._id,
        buyerId: buyOrder.userId,
        sellerId: sellOrder.userId,
        fundId: buyOrder.fundId,
        tokenAmount: matchAmount,
        pricePerToken: matchPrice,
        totalAmount: matchAmount * matchPrice,
        status: 'PENDING'
      });
      
      await trade.save();
      
      // Update buy order
      remainingAmount -= matchAmount;
      buyOrder.filledAmount += matchAmount;
      buyOrder.remainingAmount = remainingAmount;
      buyOrder.status = remainingAmount === 0 ? 'COMPLETED' : 'PARTIAL';
      await buyOrder.save();
      
      // Update sell order
      sellOrder.filledAmount += matchAmount;
      sellOrder.remainingAmount -= matchAmount;
      sellOrder.status = sellOrder.remainingAmount === 0 ? 'COMPLETED' : 'PARTIAL';
      await sellOrder.save();
      
      // Publish trade event
      await publishEvent('trade-events', {
        eventType: 'TRADE_CREATED',
        tradeId: trade._id.toString(),
        buyOrderId: buyOrder._id.toString(),
        sellOrderId: sellOrder._id.toString(),
        fundId: buyOrder.fundId.toString(),
        tokenAmount: matchAmount,
        pricePerToken: matchPrice,
        totalAmount: matchAmount * matchPrice,
        timestamp: new Date().toISOString()
      });
    }
    
    // Publish final order status
    await publishEvent('order-events', {
      eventType: 'ORDER_UPDATED',
      orderId: buyOrder._id.toString(),
      userId: buyOrder.userId.toString(),
      fundId: buyOrder.fundId.toString(),
      status: buyOrder.status,
      filledAmount: buyOrder.filledAmount,
      remainingAmount: buyOrder.remainingAmount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error matching buy order:', error);
  }
}

async function matchSellOrder(orderId) {
  try {
    const sellOrder = await Order.findById(orderId);
    if (!sellOrder || sellOrder.status !== 'PENDING') return;

    // Find matching buy orders (price >= sell order price, same fund, PENDING status)
    const matchingBuyOrders = await Order.find({
      fundId: sellOrder.fundId,
      orderType: 'BUY',
      marketType: sellOrder.marketType,
      status: { $in: ['PENDING', 'PARTIAL'] },
      pricePerToken: { $gte: sellOrder.pricePerToken }
    }).sort({ pricePerToken: -1, createdAt: 1 }); // Highest price first, then oldest

    let remainingAmount = sellOrder.tokenAmount;
    
    for (const buyOrder of matchingBuyOrders) {
      if (remainingAmount <= 0) break;
      
      const matchAmount = Math.min(remainingAmount, buyOrder.remainingAmount);
      const matchPrice = sellOrder.pricePerToken; // Use the sell order's price
      
      // Create a trade
      const trade = new Trade({
        buyOrderId: buyOrder._id,
        sellOrderId: sellOrder._id,
        buyerId: buyOrder.userId,
        sellerId: sellOrder.userId,
        fundId: sellOrder.fundId,
        tokenAmount: matchAmount,
        pricePerToken: matchPrice,
        totalAmount: matchAmount * matchPrice,
        status: 'PENDING'
      });
      
      await trade.save();
      
      // Update sell order
      remainingAmount -= matchAmount;
      sellOrder.filledAmount += matchAmount;
      sellOrder.remainingAmount = remainingAmount;
      sellOrder.status = remainingAmount === 0 ? 'COMPLETED' : 'PARTIAL';
      await sellOrder.save();
      
      // Update buy order
      buyOrder.filledAmount += matchAmount;
      buyOrder.remainingAmount -= matchAmount;
      buyOrder.status = buyOrder.remainingAmount === 0 ? 'COMPLETED' : 'PARTIAL';
      await buyOrder.save();
      
      // Publish trade event
      await publishEvent('trade-events', {
        eventType: 'TRADE_CREATED',
        tradeId: trade._id.toString(),
        buyOrderId: buyOrder._id.toString(),
        sellOrderId: sellOrder._id.toString(),
        fundId: sellOrder.fundId.toString(),
        tokenAmount: matchAmount,
        pricePerToken: matchPrice,
        totalAmount: matchAmount * matchPrice,
        timestamp: new Date().toISOString()
      });
    }
    
    // Publish final order status
    await publishEvent('order-events', {
      eventType: 'ORDER_UPDATED',
      orderId: sellOrder._id.toString(),
      userId: sellOrder.userId.toString(),
      fundId: sellOrder.fundId.toString(),
      status: sellOrder.status,
      filledAmount: sellOrder.filledAmount,
      remainingAmount: sellOrder.remainingAmount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error matching sell order:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'trading-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    kafka: {
      producer: producerConnected ? 'connected' : 'disconnected',
      consumer: consumerConnected ? 'connected' : 'disconnected'
    }
  });
});

// API ENDPOINTS

// 1. Create new order
app.post('/api/orders', validateOrderCreation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      userId,
      fundId,
      orderType,
      marketType,
      tokenAmount,
      pricePerToken,
      walletAddress
    } = req.body;

    // Calculate total amount
    const totalAmount = tokenAmount * pricePerToken;
    
    // Create the order
    const order = new Order({
      userId,
      fundId,
      orderType,
      marketType,
      tokenAmount,
      pricePerToken,
      totalAmount,
      walletAddress,
      remainingAmount: tokenAmount // Initially, remaining amount equals total amount
    });

    // For sell orders, lock the tokens
    if (orderType === 'SELL') {
      order.lockedTokens = tokenAmount;
    }

    const savedOrder = await order.save();

    // Publish event
    await publishEvent('order-events', {
      eventType: 'ORDER_CREATED',
      orderId: savedOrder._id.toString(),
      userId: savedOrder.userId.toString(),
      fundId: savedOrder.fundId.toString(),
      orderType: savedOrder.orderType,
      marketType: savedOrder.marketType,
      tokenAmount: savedOrder.tokenAmount,
      pricePerToken: savedOrder.pricePerToken,
      totalAmount: savedOrder.totalAmount,
      timestamp: new Date().toISOString()
    });

    // Try to match the order asynchronously
    if (orderType === 'BUY') {
      matchBuyOrder(savedOrder._id).catch(err => console.error('Error in async buy order matching:', err));
    } else {
      matchSellOrder(savedOrder._id).catch(err => console.error('Error in async sell order matching:', err));
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: savedOrder
    });

  } catch (error) {
    console.error('Order creation error:', error);
    
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
      message: 'Order creation failed',
      error: error.message
    });
  }
});

// 2. Get all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      userId, 
      fundId, 
      status, 
      orderType, 
      marketType 
    } = req.query;
    
    const query = {};
    
    if (userId) query.userId = userId;
    if (fundId) query.fundId = fundId;
    if (status) query.status = status;
    if (orderType) query.orderType = orderType;
    if (marketType) query.marketType = marketType;
    
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };
    
    const orders = await Order.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort);
      
    const totalOrders = await Order.countDocuments(query);
    
    res.status(200).json({
      message: 'Orders retrieved successfully',
      currentPage: options.page,
      totalPages: Math.ceil(totalOrders / options.limit),
      totalOrders,
      orders
    });
  } catch (error) {
    console.error('Error retrieving orders:', error);
    res.status(500).json({
      message: 'Failed to retrieve orders',
      error: error.message
    });
  }
});

// 3. Get order by ID
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        message: 'Order not found'
      });
    }
    
    res.status(200).json({
      message: 'Order retrieved successfully',
      order
    });
  } catch (error) {
    console.error('Error retrieving order:', error);
    res.status(500).json({
      message: 'Failed to retrieve order',
      error: error.message
    });
  }
});

// 4. Cancel order
app.patch('/api/orders/:orderId/cancel', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        message: 'Order not found'
      });
    }
    
    // Only PENDING or PARTIAL orders can be cancelled
    if (!['PENDING', 'PARTIAL'].includes(order.status)) {
      return res.status(400).json({
        message: `Order cannot be cancelled in ${order.status} status`
      });
    }
    
    order.status = 'CANCELLED';
    order.updatedAt = new Date();
    
    const updatedOrder = await order.save();
    
    // Publish event
    await publishEvent('order-events', {
      eventType: 'ORDER_CANCELLED',
      orderId: updatedOrder._id.toString(),
      userId: updatedOrder.userId.toString(),
      fundId: updatedOrder.fundId.toString(),
      timestamp: new Date().toISOString()
    });
    
    res.status(200).json({
      message: 'Order cancelled successfully',
      order: updatedOrder
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({
      message: 'Failed to cancel order',
      error: error.message
    });
  }
});

// 5. Get all trades
app.get('/api/trades', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      buyerId, 
      sellerId, 
      fundId, 
      status 
    } = req.query;
    
    const query = {};
    
    if (buyerId) query.buyerId = buyerId;
    if (sellerId) query.sellerId = sellerId;
    if (fundId) query.fundId = fundId;
    if (status) query.status = status;
    
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };
    
    const trades = await Trade.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort);
      
    const totalTrades = await Trade.countDocuments(query);
    
    res.status(200).json({
      message: 'Trades retrieved successfully',
      currentPage: options.page,
      totalPages: Math.ceil(totalTrades / options.limit),
      totalTrades,
      trades
    });
  } catch (error) {
    console.error('Error retrieving trades:', error);
    res.status(500).json({
      message: 'Failed to retrieve trades',
      error: error.message
    });
  }
});

// 6. Get trade by ID
app.get('/api/trades/:tradeId', async (req, res) => {
  try {
    const { tradeId } = req.params;
    
    const trade = await Trade.findById(tradeId);
    
    if (!trade) {
      return res.status(404).json({
        message: 'Trade not found'
      });
    }
    
    res.status(200).json({
      message: 'Trade retrieved successfully',
      trade
    });
  } catch (error) {
    console.error('Error retrieving trade:', error);
    res.status(500).json({
      message: 'Failed to retrieve trade',
      error: error.message
    });
  }
});

// 7. Get order book for a fund
app.get('/api/funds/:fundId/orderbook', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { marketType = 'SECONDARY' } = req.query;
    
    // Get buy orders (bids)
    const bids = await Order.find({
      fundId,
      orderType: 'BUY',
      marketType,
      status: { $in: ['PENDING', 'PARTIAL'] }
    }).sort({ pricePerToken: -1 }); // Sort by price descending
    
    // Get sell orders (asks)
    const asks = await Order.find({
      fundId,
      orderType: 'SELL',
      marketType,
      status: { $in: ['PENDING', 'PARTIAL'] }
    }).sort({ pricePerToken: 1 }); // Sort by price ascending
    
    // Aggregate bids by price level
    const bidLevels = bids.reduce((acc, order) => {
      const price = order.pricePerToken.toFixed(2);
      if (!acc[price]) {
        acc[price] = {
          price: parseFloat(price),
          amount: 0,
          orderCount: 0
        };
      }
      acc[price].amount += order.remainingAmount;
      acc[price].orderCount += 1;
      return acc;
    }, {});
    
    // Aggregate asks by price level
    const askLevels = asks.reduce((acc, order) => {
      const price = order.pricePerToken.toFixed(2);
      if (!acc[price]) {
        acc[price] = {
          price: parseFloat(price),
          amount: 0,
          orderCount: 0
        };
      }
      acc[price].amount += order.remainingAmount;
      acc[price].orderCount += 1;
      return acc;
    }, {});
    
    res.status(200).json({
      message: 'Order book retrieved successfully',
      fundId,
      marketType,
      bids: Object.values(bidLevels).sort((a, b) => b.price - a.price),
      asks: Object.values(askLevels).sort((a, b) => a.price - b.price)
    });
  } catch (error) {
    console.error('Error retrieving order book:', error);
    res.status(500).json({
      message: 'Failed to retrieve order book',
      error: error.message
    });
  }
});

// 8. Get market summary for a fund
app.get('/api/funds/:fundId/market-summary', async (req, res) => {
  try {
    const { fundId } = req.params;
    const { timeframe = '24h' } = req.query;
    
    // Determine start time based on timeframe
    let startTime;
    switch (timeframe) {
      case '1h':
        startTime = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '6h':
        startTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    // Get trades for the fund in the given timeframe
    const trades = await Trade.find({
      fundId,
      createdAt: { $gte: startTime }
    }).sort({ createdAt: 1 });
    
    if (trades.length === 0) {
      return res.status(200).json({
        message: 'No trading activity in the selected timeframe',
        fundId,
        timeframe,
        summary: {
          opening: 0,
          closing: 0,
          high: 0,
          low: 0,
          volume: 0,
          trades: 0,
          change: 0,
          changePercent: 0
        }
      });
    }
    
    // Calculate summary stats
    const opening = trades[0].pricePerToken;
    const closing = trades[trades.length - 1].pricePerToken;
    const high = Math.max(...trades.map(t => t.pricePerToken));
    const low = Math.min(...trades.map(t => t.pricePerToken));
    
    const volume = trades.reduce((sum, t) => sum + t.tokenAmount, 0);
    const volumeValue = trades.reduce((sum, t) => sum + t.totalAmount, 0);
    
    const change = closing - opening;
    const changePercent = opening > 0 ? (change / opening) * 100 : 0;
    
    res.status(200).json({
      message: 'Market summary retrieved successfully',
      fundId,
      timeframe,
      summary: {
        opening,
        closing,
        high,
        low,
        volume,
        volumeValue,
        trades: trades.length,
        change,
        changePercent
      }
    });
  } catch (error) {
    console.error('Error retrieving market summary:', error);
    res.status(500).json({
      message: 'Failed to retrieve market summary',
      error: error.message
    });
  }
});

// Server setup
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Trading service running on port ${PORT}`);
  });
}

module.exports = { app, server };
