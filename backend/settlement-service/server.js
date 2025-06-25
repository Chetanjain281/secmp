const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const Web3 = require('web3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3015;

// Kafka setup
const kafka = new Kafka({
  clientId: 'settlement-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'settlement-service-group' });
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
    
    // Subscribe to trade-events topic
    await consumer.subscribe({ topics: ['trade-events'], fromBeginning: false });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const eventData = JSON.parse(message.value.toString());
        console.log(`Received event from ${topic}:`, eventData);
        
        // Process trade events
        if (topic === 'trade-events') {
          await handleTradeEvent(eventData);
        }
      },
    });
    
    consumerConnected = true;
  } catch (error) {
    console.error('Error connecting to Kafka consumer:', error);
    setTimeout(connectConsumer, 5000);
  }
}

// Web3 setup - for interaction with blockchain
const web3 = new Web3(process.env.WEB3_PROVIDER || 'http://localhost:8545');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Settlement Schema - Fully aligned with Settlement.sol contract
const SettlementSchema = new mongoose.Schema({
  // Marketplace-specific identifiers
  tradeId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  buyOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  sellOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  fundId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  // ===== Contract-aligned fields =====
  // Directly matches the SettlementRecord struct in Settlement.sol
  settlementId: {
    type: Number,
    required: true
  },
  buyer: {
    type: String, // Ethereum address
    required: true
  },
  seller: {
    type: String, // Ethereum address
    required: true
  },
  fundToken: {
    type: String, // ERC20 token address
    required: true
  },
  paymentToken: {
    type: String, // ERC20 token address
    required: true
  },
  tokenAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentAmount: {
    type: Number,
    required: true,
    min: 0
  },
  settlementDate: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // Status aligned with contract's SettlementStatus enum
  status: {
    type: String,
    required: true,
    enum: ['Pending', 'InEscrow', 'Disputed', 'Resolved', 'Completed', 'Cancelled'],
    default: 'Pending'
  },
  
  // Dispute handling fields - aligned with contract
  disputeStatus: {
    type: String,
    enum: ['None', 'Raised', 'UnderReview', 'Resolved'],
    default: 'None'
  },
  disputeReason: {
    type: String,
    default: ''
  },
  disputeResolver: {
    type: String, // Ethereum address
    default: null
  },
  
  // Escrow and confirmation fields
  escrowReleaseTime: {
    type: Date,
    default: function() {
      // Default escrow period (24 hours from creation)
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  },
  buyerConfirmed: {
    type: Boolean,
    default: false
  },
  sellerConfirmed: {
    type: Boolean,
    default: false
  },
  
  // Fee information
  settlementFee: {
    type: Number,
    default: 0
  },
  feeRecipient: {
    type: String, // Ethereum address
    default: null
  },
  
  // Escrow tracking
  escrows: [{
    escrowId: {
      type: Number,
      required: true
    },
    depositor: {
      type: String, // Ethereum address
      required: true
    },
    token: {
      type: String, // ERC20 token address
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    releaseTime: {
      type: Date,
      required: true
    },
    released: {
      type: Boolean,
      default: false
    },
    purpose: {
      type: String,
      default: ''
    }
  }],
  
  // Blockchain transaction details
  transactionHash: {
    type: String,
    default: null
  },
  blockNumber: {
    type: Number,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  },
  
  // Additional timestamps for tracking
  submittedAt: {
    type: Date,
    default: null
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
SettlementSchema.index({ tradeId: 1 }, { unique: true });
SettlementSchema.index({ status: 1 });
SettlementSchema.index({ transactionHash: 1 });
SettlementSchema.index({ createdAt: -1 });

const Settlement = mongoose.model('Settlement', SettlementSchema);

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
          key: event.settlementId || event.tradeId || uuidv4(), 
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

// Handle trade events
async function handleTradeEvent(event) {
  try {
    if (event.eventType === 'TRADE_CREATED') {
      // Fetch trade details from external API or database
      const tradeDetails = await fetchTradeDetails(event.tradeId);
      
      if (!tradeDetails) {
        console.error(`Trade details not found for trade ID: ${event.tradeId}`);
        return;
      }
      
      // Get the next settlement ID
      const settlementCount = await Settlement.countDocuments();
      const settlementId = settlementCount + 1;
      
      // Calculate total payment amount from tokenAmount and pricePerToken
      const paymentAmount = tradeDetails.tokenAmount * tradeDetails.pricePerToken;
      
      // Get token addresses - in production these would come from a configuration or lookup service
      const fundTokenAddress = await getFundTokenAddress(tradeDetails.fundId);
      const paymentTokenAddress = process.env.PAYMENT_TOKEN_ADDRESS || '0x4Fabb145d64652a948d72533023f6E7A623C7C53'; // Example: BUSD
      
      // Create settlement record aligned with the Settlement.sol contract
      const settlement = new Settlement({
        // Marketplace-specific fields
        tradeId: event.tradeId,
        buyOrderId: tradeDetails.buyOrderId,
        sellOrderId: tradeDetails.sellOrderId,
        fundId: tradeDetails.fundId,
        
        // Contract-aligned fields
        settlementId,
        buyer: tradeDetails.buyerWalletAddress,
        seller: tradeDetails.sellerWalletAddress,
        fundToken: fundTokenAddress,
        paymentToken: paymentTokenAddress,
        tokenAmount: tradeDetails.tokenAmount,
        paymentAmount: paymentAmount,
        settlementDate: new Date(),
        status: 'Pending',
        
        // Set escrow release time (24 hours from now as per contract default)
        escrowReleaseTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      
      await settlement.save();
      
      console.log(`Created settlement with ID ${settlementId} for trade ${event.tradeId}`);
      
      // Publish event that settlement was created
      await publishEvent('settlement-events', {
        eventType: 'SETTLEMENT_CREATED',
        settlementId: settlement._id.toString(),
        tradeId: settlement.tradeId.toString(),
        buyer: settlement.buyer,
        seller: settlement.seller,
        tokenAmount: settlement.tokenAmount,
        paymentAmount: settlement.paymentAmount,
        timestamp: new Date().toISOString()
      });
      
      // Start settlement process asynchronously
      processSettlement(settlement._id).catch(err => {
        console.error(`Error processing settlement ${settlement._id}:`, err);
      });
    }
  } catch (error) {
    console.error('Error handling trade event:', error);
  }
}

// Mock function to get fund token address - in production would call fund service or blockchain
async function getFundTokenAddress(fundId) {
  // This would be replaced with a real lookup in production
  return `0x${fundId.toString().substring(0, 8)}fC5E56E3F79B9e5d4838Ac1810F663c7`;
}

// Fetch trade details (mock implementation)
async function fetchTradeDetails(tradeId) {
  try {
    // In a real implementation, this would make an API call to the trading service
    // For now, we'll simulate it with a mock response
    // await new Promise(resolve => setTimeout(resolve, 100));
    
    // For demo purpose, generate mock data based on the tradeId
    return {
      _id: tradeId,
      buyOrderId: `60d0fe4f5311236168a109${tradeId.slice(-2)}`,
      sellOrderId: `60d0fe4f5311236168a110${tradeId.slice(-2)}`,
      fundId: `60d0fe4f5311236168a111${tradeId.slice(-2)}`,
      tokenAmount: 100,
      pricePerToken: 10.5,
      totalAmount: 1050,
      buyerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
      sellerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2'
    };
  } catch (error) {
    console.error(`Error fetching trade details for trade ID: ${tradeId}`, error);
    return null;
  }
}

// Process settlement - Aligns with createSettlement function in Settlement.sol
async function processSettlement(settlementId) {
  try {
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      console.error(`Settlement not found with ID: ${settlementId}`);
      return;
    }
    
    if (settlement.status !== 'Pending') {
      console.log(`Settlement ${settlementId} is already in ${settlement.status} status, skipping processing`);
      return;
    }
    
    // Calculate settlement fee (0.25% as per contract's settlementFeeRate = 25)
    const feeRate = 25; // 0.25% (basis points)
    const fee = (settlement.paymentAmount * feeRate) / 10000;
    settlement.settlementFee = fee;
    settlement.feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || '0x742d35Cc6627C0532e5b76B4d5A25065ca90b7c1';
    
    // Update status and timestamps
    settlement.submittedAt = new Date();
    await settlement.save();
    
    // Publish event
    await publishEvent('settlement-events', {
      eventType: 'SETTLEMENT_CREATED',
      settlementId: settlement._id.toString(),
      tradeId: settlement.tradeId.toString(),
      buyer: settlement.buyer,
      seller: settlement.seller,
      fundToken: settlement.fundToken,
      tokenAmount: settlement.tokenAmount,
      paymentAmount: settlement.paymentAmount,
      status: settlement.status,
      timestamp: new Date().toISOString()
    });
    
    // Simulate blockchain transaction - in production, this would call the smart contract
    try {
      const txHash = await createBlockchainSettlement(settlement);
      
      // Update settlement with transaction hash
      settlement.transactionHash = txHash;
      settlement.blockNumber = await getBlockNumber(txHash);
      await settlement.save();
      
      // Publish event for successful creation on blockchain
      await publishEvent('settlement-events', {
        eventType: 'SETTLEMENT_SUBMITTED_TO_BLOCKCHAIN',
        settlementId: settlement._id.toString(),
        tradeId: settlement.tradeId.toString(),
        transactionHash: txHash,
        blockNumber: settlement.blockNumber,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      // Implement retry logic with exponential backoff for transient failures
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;
      
      while (retryCount < maxRetries && !success) {
        try {
          console.log(`Retrying blockchain settlement for ${settlementId}, attempt ${retryCount + 1}`);
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          
          const txHash = await createBlockchainSettlement(settlement);
          settlement.transactionHash = txHash;
          settlement.blockNumber = await getBlockNumber(txHash);
          await settlement.save();
          
          success = true;
          
          // Publish success event
          await publishEvent('settlement-events', {
            eventType: 'SETTLEMENT_SUBMITTED_TO_BLOCKCHAIN',
            settlementId: settlement._id.toString(),
            tradeId: settlement.tradeId.toString(),
            transactionHash: txHash,
            blockNumber: settlement.blockNumber,
            retryCount,
            timestamp: new Date().toISOString()
          });
          
        } catch (retryError) {
          retryCount++;
          if (retryCount >= maxRetries) {
            // Mark as failed after all retries exhausted
            settlement.errorMessage = `Failed after ${maxRetries} attempts: ${retryError.message}`;
            await settlement.save();
            
            // Publish failure event
            await publishEvent('settlement-events', {
              eventType: 'SETTLEMENT_BLOCKCHAIN_FAILED',
              settlementId: settlement._id.toString(),
              tradeId: settlement.tradeId.toString(),
              error: settlement.errorMessage,
              retryCount,
              timestamp: new Date().toISOString()
            });
            
            throw retryError;
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error processing settlement ${settlementId}:`, error);
  }
}

// Create settlement on blockchain
async function createBlockchainSettlement(settlement) {
  try {
    // Simulate blockchain transaction delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // In production, this would construct a contract call to Settlement.sol's createSettlement function:
    // const contract = new web3.eth.Contract(SettlementABI, contractAddress);
    // const gasPrice = await web3.eth.getGasPrice();
    // const tx = await contract.methods.createSettlement(
    //   settlement.buyer,
    //   settlement.seller,
    //   settlement.fundToken,
    //   settlement.paymentToken,
    //   settlement.tokenAmount,
    //   settlement.paymentAmount,
    //   Math.floor(new Date(settlement.settlementDate).getTime() / 1000) // Convert to Unix timestamp
    // ).send({
    //   from: process.env.SERVICE_WALLET_ADDRESS,
    //   gas: 3000000,
    //   gasPrice
    // });
    // return tx.transactionHash;
    
    // For now, just return a mock transaction hash
    // 5% chance of failure for testing purposes
    if (Math.random() < 0.05) {
      throw new Error('Blockchain transaction failed: gas estimation error');
    }
    
    return `0x${Math.random().toString(16).substr(2, 64)}`;
  } catch (error) {
    console.error(`Error creating blockchain settlement:`, error);
    throw error;
  }
}

// Get block number from transaction hash
async function getBlockNumber(txHash) {
  // In production, this would use web3 to get the actual block number:
  // const receipt = await web3.eth.getTransactionReceipt(txHash);
  // return receipt.blockNumber;
  
  // For now, just return a mock block number
  return Math.floor(Math.random() * 1000000) + 15000000;
}

// Simulate blockchain settlement
async function simulateBlockchainSettlement(settlement) {
  // Simulate blockchain transaction delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 5% chance of failure for testing purposes
  if (Math.random() < 0.05) {
    throw new Error('Blockchain transaction failed');
  }
  
  // Return a mock transaction hash
  return `0x${Math.random().toString(16).substr(2, 64)}`;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'settlement-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    kafka: {
      producer: producerConnected ? 'connected' : 'disconnected',
      consumer: consumerConnected ? 'connected' : 'disconnected'
    }
  });
});

// API ENDPOINTS

// 1. Get all settlements
app.get('/api/settlements', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      tradeId 
    } = req.query;
    
    const query = {};
    
    if (status) query.status = status;
    if (tradeId) query.tradeId = tradeId;
    
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };
    
    const settlements = await Settlement.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort);
      
    const totalSettlements = await Settlement.countDocuments(query);
    
    res.status(200).json({
      message: 'Settlements retrieved successfully',
      currentPage: options.page,
      totalPages: Math.ceil(totalSettlements / options.limit),
      totalSettlements,
      settlements
    });
  } catch (error) {
    console.error('Error retrieving settlements:', error);
    res.status(500).json({
      message: 'Failed to retrieve settlements',
      error: error.message
    });
  }
});

// 2. Get settlement by ID
app.get('/api/settlements/:settlementId', async (req, res) => {
  try {
    const { settlementId } = req.params;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    res.status(200).json({
      message: 'Settlement retrieved successfully',
      settlement
    });
  } catch (error) {
    console.error('Error retrieving settlement:', error);
    res.status(500).json({
      message: 'Failed to retrieve settlement',
      error: error.message
    });
  }
});

// 3. Retry failed settlement
app.post('/api/settlements/:settlementId/retry', async (req, res) => {
  try {
    const { settlementId } = req.params;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    if (settlement.status !== 'FAILED') {
      return res.status(400).json({
        message: `Settlement cannot be retried in ${settlement.status} status`
      });
    }
    
    // Reset settlement to PENDING status
    settlement.status = 'PENDING';
    settlement.errorMessage = null;
    settlement.updatedAt = new Date();
    
    await settlement.save();
    
    // Start settlement process
    processSettlement(settlement._id).catch(err => {
      console.error(`Error processing settlement ${settlement._id}:`, err);
    });
    
    res.status(200).json({
      message: 'Settlement retry initiated successfully',
      settlement
    });
  } catch (error) {
    console.error('Error retrying settlement:', error);
    res.status(500).json({
      message: 'Failed to retry settlement',
      error: error.message
    });
  }
});

// 4. Confirm settlement (buyer or seller confirmation)
app.post('/api/settlements/:settlementId/confirm', [
  body('confirmerAddress').isEthereumAddress().withMessage('Valid Ethereum address required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { settlementId } = req.params;
    const { confirmerAddress } = req.body;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    if (settlement.status === 'Completed' || settlement.status === 'Cancelled') {
      return res.status(400).json({
        message: `Settlement is already ${settlement.status.toLowerCase()}`
      });
    }

    // Check if confirmer is buyer or seller
    const isBuyer = confirmerAddress.toLowerCase() === settlement.buyer.toLowerCase();
    const isSeller = confirmerAddress.toLowerCase() === settlement.seller.toLowerCase();
    
    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        message: 'Only buyer or seller can confirm settlement'
      });
    }

    // Update confirmation status
    if (isBuyer && !settlement.buyerConfirmed) {
      settlement.buyerConfirmed = true;
    } else if (isSeller && !settlement.sellerConfirmed) {
      settlement.sellerConfirmed = true;
    } else {
      return res.status(400).json({
        message: 'Party has already confirmed settlement'
      });
    }

    settlement.updatedAt = new Date();
    await settlement.save();

    // Publish confirmation event
    await publishEvent('settlement-events', {
      eventType: 'SETTLEMENT_CONFIRMED',
      settlementId: settlement._id.toString(),
      confirmer: confirmerAddress,
      buyerConfirmed: settlement.buyerConfirmed,
      sellerConfirmed: settlement.sellerConfirmed,
      timestamp: new Date().toISOString()
    });

    // If both parties confirmed, complete settlement
    if (settlement.buyerConfirmed && settlement.sellerConfirmed) {
      settlement.status = 'Completed';
      settlement.confirmedAt = new Date();
      await settlement.save();

      await publishEvent('settlement-events', {
        eventType: 'SETTLEMENT_COMPLETED',
        settlementId: settlement._id.toString(),
        completedAt: settlement.confirmedAt.toISOString(),
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      message: 'Settlement confirmation recorded successfully',
      settlement,
      bothPartiesConfirmed: settlement.buyerConfirmed && settlement.sellerConfirmed
    });
  } catch (error) {
    console.error('Error confirming settlement:', error);
    res.status(500).json({
      message: 'Failed to confirm settlement',
      error: error.message
    });
  }
});

// 5. Raise dispute
app.post('/api/settlements/:settlementId/dispute', [
  body('disputantAddress').isEthereumAddress().withMessage('Valid Ethereum address required'),
  body('reason').isLength({ min: 10, max: 500 }).withMessage('Dispute reason must be between 10 and 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { settlementId } = req.params;
    const { disputantAddress, reason } = req.body;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    if (settlement.status === 'Completed' || settlement.status === 'Cancelled') {
      return res.status(400).json({
        message: `Cannot raise dispute for ${settlement.status.toLowerCase()} settlement`
      });
    }

    if (settlement.disputeStatus !== 'None') {
      return res.status(400).json({
        message: `Dispute already ${settlement.disputeStatus.toLowerCase()}`
      });
    }

    // Check if disputant is buyer or seller
    const isBuyer = disputantAddress.toLowerCase() === settlement.buyer.toLowerCase();
    const isSeller = disputantAddress.toLowerCase() === settlement.seller.toLowerCase();
    
    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        message: 'Only buyer or seller can raise dispute'
      });
    }

    // Update dispute status
    settlement.disputeStatus = 'Raised';
    settlement.disputeReason = reason;
    settlement.status = 'Disputed';
    settlement.updatedAt = new Date();
    
    await settlement.save();

    // Publish dispute event
    await publishEvent('settlement-events', {
      eventType: 'DISPUTE_RAISED',
      settlementId: settlement._id.toString(),
      disputant: disputantAddress,
      reason: reason,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Dispute raised successfully',
      settlement
    });
  } catch (error) {
    console.error('Error raising dispute:', error);
    res.status(500).json({
      message: 'Failed to raise dispute',
      error: error.message
    });
  }
});

// 6. Resolve dispute (admin/resolver only)
app.post('/api/settlements/:settlementId/resolve-dispute', [
  body('resolverAddress').isEthereumAddress().withMessage('Valid resolver Ethereum address required'),
  body('buyerFavored').isBoolean().withMessage('buyerFavored must be a boolean'),
  body('resolutionNotes').optional().isLength({ max: 1000 }).withMessage('Resolution notes cannot exceed 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { settlementId } = req.params;
    const { resolverAddress, buyerFavored, resolutionNotes = '' } = req.body;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    if (settlement.disputeStatus !== 'Raised') {
      return res.status(400).json({
        message: 'No active dispute to resolve'
      });
    }

    // In production, you would check if resolverAddress is an authorized dispute resolver
    // For now, we'll accept any valid address
    
    // Update dispute resolution
    settlement.disputeStatus = 'Resolved';
    settlement.disputeResolver = resolverAddress;
    settlement.status = 'Resolved';
    settlement.updatedAt = new Date();
    
    // Add resolution notes to dispute reason if provided
    if (resolutionNotes) {
      settlement.disputeReason += `\n\nResolution: ${resolutionNotes}`;
    }
    
    await settlement.save();

    // Publish dispute resolution event
    await publishEvent('settlement-events', {
      eventType: 'DISPUTE_RESOLVED',
      settlementId: settlement._id.toString(),
      resolver: resolverAddress,
      buyerFavored: buyerFavored,
      resolutionNotes: resolutionNotes,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Dispute resolved successfully',
      settlement,
      resolution: {
        buyerFavored,
        resolver: resolverAddress,
        notes: resolutionNotes
      }
    });
  } catch (error) {
    console.error('Error resolving dispute:', error);
    res.status(500).json({
      message: 'Failed to resolve dispute',
      error: error.message
    });
  }
});

// 7. Create batch settlement
app.post('/api/settlements/batch', [
  body('settlementIds').isArray({ min: 1, max: 50 }).withMessage('Settlement IDs array must contain 1-50 items'),
  body('settlementIds.*').isMongoId().withMessage('Each settlement ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { settlementIds } = req.body;
    
    // Validate all settlements exist and are in correct status
    const settlements = await Settlement.find({ 
      _id: { $in: settlementIds },
      status: 'InEscrow'
    });
    
    if (settlements.length !== settlementIds.length) {
      return res.status(400).json({
        message: 'Some settlements not found or not in InEscrow status'
      });
    }

    // Validate all settlements use same fund and payment tokens
    const firstSettlement = settlements[0];
    const tokenMismatch = settlements.some(s => 
      s.fundToken !== firstSettlement.fundToken || 
      s.paymentToken !== firstSettlement.paymentToken
    );

    if (tokenMismatch) {
      return res.status(400).json({
        message: 'All settlements in batch must use same fund and payment tokens'
      });
    }

    // Calculate batch totals
    const totalTokens = settlements.reduce((sum, s) => sum + s.tokenAmount, 0);
    const totalPayment = settlements.reduce((sum, s) => sum + s.paymentAmount, 0);

    // Create batch settlement record (this would be stored in a separate collection)
    const batchSettlement = {
      batchId: uuidv4(),
      settlementIds: settlementIds,
      totalTokens,
      totalPayment,
      fundToken: firstSettlement.fundToken,
      paymentToken: firstSettlement.paymentToken,
      executionTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      executed: false,
      createdAt: new Date()
    };

    // Publish batch creation event
    await publishEvent('settlement-events', {
      eventType: 'BATCH_SETTLEMENT_CREATED',
      batchId: batchSettlement.batchId,
      settlementIds: settlementIds,
      totalTokens,
      totalPayment,
      executionTime: batchSettlement.executionTime.toISOString(),
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      message: 'Batch settlement created successfully',
      batchSettlement
    });
  } catch (error) {
    console.error('Error creating batch settlement:', error);
    res.status(500).json({
      message: 'Failed to create batch settlement',
      error: error.message
    });
  }
});

// 8. Cancel settlement
app.post('/api/settlements/:settlementId/cancel', [
  body('reason').isLength({ min: 5, max: 500 }).withMessage('Cancellation reason must be between 5 and 500 characters'),
  body('cancellerAddress').isEthereumAddress().withMessage('Valid Ethereum address required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { settlementId } = req.params;
    const { reason, cancellerAddress } = req.body;
    
    const settlement = await Settlement.findById(settlementId);
    
    if (!settlement) {
      return res.status(404).json({
        message: 'Settlement not found'
      });
    }
    
    if (settlement.status === 'Completed' || settlement.status === 'Cancelled') {
      return res.status(400).json({
        message: `Settlement is already ${settlement.status.toLowerCase()}`
      });
    }

    // Check if canceller is buyer, seller, or admin (for now, allow any address)
    const isBuyer = cancellerAddress.toLowerCase() === settlement.buyer.toLowerCase();
    const isSeller = cancellerAddress.toLowerCase() === settlement.seller.toLowerCase();
    
    if (!isBuyer && !isSeller) {
      // In production, you would check for admin role here
      return res.status(403).json({
        message: 'Only buyer, seller, or admin can cancel settlement'
      });
    }

    // Update settlement status
    settlement.status = 'Cancelled';
    settlement.updatedAt = new Date();
    
    await settlement.save();

    // Publish cancellation event
    await publishEvent('settlement-events', {
      eventType: 'SETTLEMENT_CANCELLED',
      settlementId: settlement._id.toString(),
      canceller: cancellerAddress,
      reason: reason,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      message: 'Settlement cancelled successfully',
      settlement,
      cancellationReason: reason
    });
  } catch (error) {
    console.error('Error cancelling settlement:', error);
    res.status(500).json({
      message: 'Failed to cancel settlement',
      error: error.message
    });
  }
});

// Server setup
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Settlement service running on port ${PORT}`);
  });
}

module.exports = { app, server };
