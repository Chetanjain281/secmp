const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const { Kafka } = require('kafkajs');
const { ethers } = require('ethers');
const Web3 = require('web3');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3016;

// Blockchain setup
const provider = new ethers.providers.JsonRpcProvider(process.env.WEB3_PROVIDER || 'http://localhost:8545');
const web3 = new Web3(process.env.WEB3_PROVIDER || 'http://localhost:8545');

// Service wallet for blockchain transactions
const serviceWallet = new ethers.Wallet(
  process.env.SERVICE_WALLET_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  provider
);

// Kafka setup
const kafka = new Kafka({
  clientId: 'blockchain-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'blockchain-service-group' });
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
    
    // Subscribe to blockchain-related events
    await consumer.subscribe({ 
      topics: ['settlement-requests', 'fund-deployment-requests', 'trade-execution-requests'], 
      fromBeginning: false 
    });
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const eventData = JSON.parse(message.value.toString());
        console.log(`Received event from ${topic}:`, eventData);
        
        switch(topic) {
          case 'settlement-requests':
            await handleSettlementRequest(eventData);
            break;
          case 'fund-deployment-requests':
            await handleFundDeployment(eventData);
            break;
          case 'trade-execution-requests':
            await handleTradeExecution(eventData);
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

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Contract Transaction Schema
const ContractTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['SETTLEMENT', 'FUND_DEPLOYMENT', 'TRADE_EXECUTION', 'ESCROW_DEPOSIT', 'DISPUTE_RESOLUTION']
  },
  contractAddress: {
    type: String,
    required: true
  },
  methodName: {
    type: String,
    required: true
  },
  parameters: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  transactionHash: {
    type: String,
    default: null
  },
  blockNumber: {
    type: Number,
    default: null
  },
  gasUsed: {
    type: Number,
    default: null
  },
  gasPrice: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'],
    default: 'PENDING'
  },
  errorMessage: {
    type: String,
    default: null
  },
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  confirmedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

const ContractTransaction = mongoose.model('ContractTransaction', ContractTransactionSchema);

// Start Kafka connections
connectProducer();
connectConsumer();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// Smart Contract ABIs (simplified - in production these would be imported from compiled contracts)
const SETTLEMENT_ABI = [
  // Settlement contract methods
  {    "inputs": [
      {"name": "_buyer", "type": "address"},
      {"name": "_seller", "type": "address"},
      {"name": "_fundToken", "type": "address"},
      {"name": "_paymentToken", "type": "address"},
      {"name": "_tokenAmount", "type": "uint256"},
      {"name": "_paymentAmount", "type": "uint256"},
      {"name": "_settlementDate", "type": "uint256"}
    ],
    "name": "createSettlement",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [
      {"name": "_settlementId", "type": "uint256"},
      {"name": "_token", "type": "address"},
      {"name": "_amount", "type": "uint256"},
      {"name": "_purpose", "type": "string"}
    ],
    "name": "depositEscrow",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [{"name": "_settlementId", "type": "uint256"}],
    "name": "confirmSettlement",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [
      {"name": "_settlementId", "type": "uint256"},
      {"name": "_reason", "type": "string"}
    ],
    "name": "raiseDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [
      {"name": "_settlementId", "type": "uint256"},
      {"name": "_buyerFavored", "type": "bool"}
    ],
    "name": "resolveDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [{"name": "_escrowId", "type": "uint256"}],
    "name": "releaseEscrow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [{"name": "_settlementIds", "type": "uint256[]"}],
    "name": "createBatchSettlement",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },  {
    "inputs": [{"name": "_batchId", "type": "uint256"}],
    "name": "executeBatchSettlement",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },  // View functions
  {
    "inputs": [{"name": "_settlementId", "type": "uint256"}],
    "name": "getSettlement",
    "outputs": [
      {
        "components": [
          {"name": "settlementId", "type": "uint256"},
          {"name": "buyer", "type": "address"},
          {"name": "seller", "type": "address"},
          {"name": "fundToken", "type": "address"},
          {"name": "paymentToken", "type": "address"},
          {"name": "tokenAmount", "type": "uint256"},
          {"name": "paymentAmount", "type": "uint256"},
          {"name": "settlementDate", "type": "uint256"},
          {"name": "createdAt", "type": "uint256"},
          {"name": "status", "type": "uint8"},
          {"name": "disputeStatus", "type": "uint8"},
          {"name": "disputeReason", "type": "string"},
          {"name": "disputeResolver", "type": "address"},
          {"name": "escrowReleaseTime", "type": "uint256"},
          {"name": "buyerConfirmed", "type": "bool"},
          {"name": "sellerConfirmed", "type": "bool"},
          {"name": "settlementFee", "type": "uint256"},
          {"name": "feeRecipient", "type": "address"}
        ],
        "name": "",
        "type": "tuple"
      }    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// Contract instances
const settlementContract = new ethers.Contract(
  process.env.SETTLEMENT_ADDRESS || '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  SETTLEMENT_ABI,
  serviceWallet
);

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
          key: event.transactionId || event.settlementId || uuidv4(), 
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

// Handle settlement requests from settlement-service
async function handleSettlementRequest(event) {
  try {
    if (event.eventType === 'CREATE_SETTLEMENT') {
      await createSettlementOnChain(event);
    } else if (event.eventType === 'CONFIRM_SETTLEMENT') {
      await confirmSettlementOnChain(event);
    } else if (event.eventType === 'DEPOSIT_ESCROW') {
      await depositEscrowOnChain(event);
    } else if (event.eventType === 'RAISE_DISPUTE') {
      await raiseDisputeOnChain(event);
    } else if (event.eventType === 'RESOLVE_DISPUTE') {
      await resolveDisputeOnChain(event);
    } else if (event.eventType === 'CREATE_BATCH_SETTLEMENT') {
      await createBatchSettlementOnChain(event);
    }
  } catch (error) {
    console.error('Error handling settlement request:', error);
  }
}

// Create settlement on blockchain
async function createSettlementOnChain(event) {
  const transaction = new ContractTransaction({
    type: 'SETTLEMENT',
    contractAddress: process.env.SETTLEMENT_ADDRESS,
    methodName: 'createSettlement',
    parameters: {
      buyer: event.buyer,
      seller: event.seller,
      fundToken: event.fundToken,
      paymentToken: event.paymentToken,
      tokenAmount: event.tokenAmount,
      paymentAmount: event.paymentAmount,
      settlementDate: Math.floor(new Date(event.settlementDate).getTime() / 1000)
    }
  });

  try {
    await transaction.save();
    
    // Estimate gas
    const gasEstimate = await settlementContract.estimateGas.createSettlement(
      event.buyer,
      event.seller,
      event.fundToken,
      event.paymentToken,
      ethers.utils.parseUnits(event.tokenAmount.toString(), 18),
      ethers.utils.parseUnits(event.paymentAmount.toString(), 6), // Assuming USDC has 6 decimals
      Math.floor(new Date(event.settlementDate).getTime() / 1000)
    );

    // Execute transaction
    const tx = await settlementContract.createSettlement(
      event.buyer,
      event.seller,
      event.fundToken,
      event.paymentToken,
      ethers.utils.parseUnits(event.tokenAmount.toString(), 18),
      ethers.utils.parseUnits(event.paymentAmount.toString(), 6),
      Math.floor(new Date(event.settlementDate).getTime() / 1000),
      {
        gasLimit: gasEstimate.mul(120).div(100), // Add 20% buffer
        gasPrice: await provider.getGasPrice()
      }
    );

    // Update transaction record
    transaction.transactionHash = tx.hash;
    transaction.gasPrice = tx.gasPrice.toString();
    transaction.status = 'SUBMITTED';
    await transaction.save();

    // Wait for confirmation
    const receipt = await tx.wait();
    
    transaction.blockNumber = receipt.blockNumber;
    transaction.gasUsed = receipt.gasUsed.toNumber();
    transaction.status = 'CONFIRMED';
    transaction.confirmedAt = new Date();
    await transaction.save();

    // Parse settlement ID from transaction logs
    const settlementCreatedEvent = receipt.events.find(e => e.event === 'SettlementCreated');
    const onChainSettlementId = settlementCreatedEvent?.args?.settlementId?.toNumber();

    // Publish success event
    await publishEvent('blockchain-events', {
      eventType: 'SETTLEMENT_CREATED_ON_CHAIN',
      settlementId: event.settlementId,
      onChainSettlementId,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toNumber(),
      timestamp: new Date().toISOString()
    });

    console.log(`Settlement created on-chain with ID ${onChainSettlementId}, tx: ${tx.hash}`);

  } catch (error) {
    transaction.status = 'FAILED';
    transaction.errorMessage = error.message;
    transaction.retryCount += 1;
    await transaction.save();

    // Publish failure event
    await publishEvent('blockchain-events', {
      eventType: 'SETTLEMENT_CREATION_FAILED',
      settlementId: event.settlementId,
      error: error.message,
      retryCount: transaction.retryCount,
      timestamp: new Date().toISOString()
    });

    // Retry if under max retries
    if (transaction.retryCount < transaction.maxRetries) {
      setTimeout(() => {
        createSettlementOnChain(event).catch(console.error);
      }, Math.pow(2, transaction.retryCount) * 1000); // Exponential backoff
    }

    throw error;
  }
}

// Confirm settlement on blockchain
async function confirmSettlementOnChain(event) {
  const transaction = new ContractTransaction({
    type: 'SETTLEMENT',
    contractAddress: process.env.SETTLEMENT_ADDRESS,
    methodName: 'confirmSettlement',
    parameters: {
      settlementId: event.onChainSettlementId
    }
  });

  try {
    await transaction.save();

    const tx = await settlementContract.confirmSettlement(event.onChainSettlementId, {
      gasLimit: 200000,
      gasPrice: await provider.getGasPrice()
    });

    transaction.transactionHash = tx.hash;
    transaction.status = 'SUBMITTED';
    await transaction.save();

    const receipt = await tx.wait();
    
    transaction.blockNumber = receipt.blockNumber;
    transaction.gasUsed = receipt.gasUsed.toNumber();
    transaction.status = 'CONFIRMED';
    transaction.confirmedAt = new Date();
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'SETTLEMENT_CONFIRMED_ON_CHAIN',
      settlementId: event.settlementId,
      onChainSettlementId: event.onChainSettlementId,
      confirmer: event.confirmer,
      transactionHash: tx.hash,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    transaction.status = 'FAILED';
    transaction.errorMessage = error.message;
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'SETTLEMENT_CONFIRMATION_FAILED',
      settlementId: event.settlementId,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

// Deposit escrow on blockchain
async function depositEscrowOnChain(event) {
  const transaction = new ContractTransaction({
    type: 'ESCROW_DEPOSIT',
    contractAddress: process.env.SETTLEMENT_ADDRESS,
    methodName: 'depositEscrow',
    parameters: {
      settlementId: event.onChainSettlementId,
      token: event.token,
      amount: event.amount,
      purpose: event.purpose
    }
  });

  try {
    await transaction.save();

    const tx = await settlementContract.depositEscrow(
      event.onChainSettlementId,
      event.token,
      ethers.utils.parseUnits(event.amount.toString(), event.decimals || 18),
      event.purpose,
      {
        gasLimit: 300000,
        gasPrice: await provider.getGasPrice()
      }
    );

    transaction.transactionHash = tx.hash;
    transaction.status = 'SUBMITTED';
    await transaction.save();

    const receipt = await tx.wait();
    
    transaction.blockNumber = receipt.blockNumber;
    transaction.gasUsed = receipt.gasUsed.toNumber();
    transaction.status = 'CONFIRMED';
    transaction.confirmedAt = new Date();
    await transaction.save();

    // Parse escrow ID from transaction logs
    const escrowDepositedEvent = receipt.events.find(e => e.event === 'EscrowDeposited');
    const escrowId = escrowDepositedEvent?.args?.escrowId?.toNumber();

    await publishEvent('blockchain-events', {
      eventType: 'ESCROW_DEPOSITED_ON_CHAIN',
      settlementId: event.settlementId,
      escrowId,
      transactionHash: tx.hash,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    transaction.status = 'FAILED';
    transaction.errorMessage = error.message;
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'ESCROW_DEPOSIT_FAILED',
      settlementId: event.settlementId,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

// Raise dispute on blockchain
async function raiseDisputeOnChain(event) {
  const transaction = new ContractTransaction({
    type: 'DISPUTE_RESOLUTION',
    contractAddress: process.env.SETTLEMENT_ADDRESS,
    methodName: 'raiseDispute',
    parameters: {
      settlementId: event.onChainSettlementId,
      reason: event.reason
    }
  });

  try {
    await transaction.save();

    const tx = await settlementContract.raiseDispute(
      event.onChainSettlementId,
      event.reason,
      {
        gasLimit: 200000,
        gasPrice: await provider.getGasPrice()
      }
    );

    transaction.transactionHash = tx.hash;
    transaction.status = 'SUBMITTED';
    await transaction.save();

    const receipt = await tx.wait();
    
    transaction.blockNumber = receipt.blockNumber;
    transaction.gasUsed = receipt.gasUsed.toNumber();
    transaction.status = 'CONFIRMED';
    transaction.confirmedAt = new Date();
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'DISPUTE_RAISED_ON_CHAIN',
      settlementId: event.settlementId,
      reason: event.reason,
      transactionHash: tx.hash,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    transaction.status = 'FAILED';
    transaction.errorMessage = error.message;
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'DISPUTE_RAISE_FAILED',
      settlementId: event.settlementId,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

// Create batch settlement on blockchain
async function createBatchSettlementOnChain(event) {
  const transaction = new ContractTransaction({
    type: 'SETTLEMENT',
    contractAddress: process.env.SETTLEMENT_ADDRESS,
    methodName: 'createBatchSettlement',
    parameters: {
      settlementIds: event.settlementIds
    }
  });

  try {
    await transaction.save();

    const tx = await settlementContract.createBatchSettlement(event.settlementIds, {
      gasLimit: 500000 + (event.settlementIds.length * 50000), // Dynamic gas based on batch size
      gasPrice: await provider.getGasPrice()
    });

    transaction.transactionHash = tx.hash;
    transaction.status = 'SUBMITTED';
    await transaction.save();

    const receipt = await tx.wait();
    
    transaction.blockNumber = receipt.blockNumber;
    transaction.gasUsed = receipt.gasUsed.toNumber();
    transaction.status = 'CONFIRMED';
    transaction.confirmedAt = new Date();
    await transaction.save();

    // Parse batch ID from transaction logs
    const batchCreatedEvent = receipt.events.find(e => e.event === 'BatchSettlementCreated');
    const batchId = batchCreatedEvent?.args?.batchId?.toNumber();

    await publishEvent('blockchain-events', {
      eventType: 'BATCH_SETTLEMENT_CREATED_ON_CHAIN',
      batchId,
      settlementIds: event.settlementIds,
      transactionHash: tx.hash,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    transaction.status = 'FAILED';
    transaction.errorMessage = error.message;
    await transaction.save();

    await publishEvent('blockchain-events', {
      eventType: 'BATCH_SETTLEMENT_CREATION_FAILED',
      settlementIds: event.settlementIds,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}

// Handle fund deployment requests
async function handleFundDeployment(event) {
  try {
    console.log('Fund deployment request received:', event);
    // Implementation for fund deployment would go here
    // This would interact with FundFactory.sol
  } catch (error) {
    console.error('Error handling fund deployment:', error);
  }
}

// Handle trade execution requests
async function handleTradeExecution(event) {
  try {
    console.log('Trade execution request received:', event);
    // Implementation for trade execution would go here
    // This would interact with Marketplace.sol
  } catch (error) {
    console.error('Error handling trade execution:', error);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    const walletBalance = await provider.getBalance(serviceWallet.address);
    
    res.status(200).json({
      status: 'ok',
      service: 'blockchain-service',
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      kafka: {
        producer: producerConnected ? 'connected' : 'disconnected',
        consumer: consumerConnected ? 'connected' : 'disconnected'
      },
      blockchain: {
        connected: true,
        blockNumber,
        walletAddress: serviceWallet.address,
        walletBalance: ethers.utils.formatEther(walletBalance)
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      service: 'blockchain-service',
      error: error.message
    });
  }
});

// API ENDPOINTS

// 1. Get contract transaction by ID
app.get('/api/transactions/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await ContractTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        message: 'Transaction not found'
      });
    }
    
    res.status(200).json({
      message: 'Transaction retrieved successfully',
      transaction
    });
  } catch (error) {
    console.error('Error retrieving transaction:', error);
    res.status(500).json({
      message: 'Failed to retrieve transaction',
      error: error.message
    });
  }
});

// 2. Get all contract transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      type,
      contractAddress 
    } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (contractAddress) query.contractAddress = contractAddress;
    
    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 }
    };
    
    const transactions = await ContractTransaction.find(query)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .sort(options.sort);
      
    const totalTransactions = await ContractTransaction.countDocuments(query);
    
    res.status(200).json({
      message: 'Transactions retrieved successfully',
      currentPage: options.page,
      totalPages: Math.ceil(totalTransactions / options.limit),
      totalTransactions,
      transactions
    });
  } catch (error) {
    console.error('Error retrieving transactions:', error);
    res.status(500).json({
      message: 'Failed to retrieve transactions',
      error: error.message
    });
  }
});

// 3. Get on-chain settlement details
app.get('/api/settlements/:settlementId/onchain', async (req, res) => {
  try {
    const { settlementId } = req.params;
    
    // Get settlement details from smart contract
    const settlement = await settlementContract.getSettlement(settlementId);
    
    res.status(200).json({
      message: 'On-chain settlement retrieved successfully',
      settlement: {
        settlementId: settlement.settlementId.toNumber(),
        buyer: settlement.buyer,
        seller: settlement.seller,
        fundToken: settlement.fundToken,
        paymentToken: settlement.paymentToken,
        tokenAmount: ethers.utils.formatUnits(settlement.tokenAmount, 18),
        paymentAmount: ethers.utils.formatUnits(settlement.paymentAmount, 6),
        settlementDate: new Date(settlement.settlementDate.toNumber() * 1000),
        createdAt: new Date(settlement.createdAt.toNumber() * 1000),
        status: settlement.status,
        disputeStatus: settlement.disputeStatus,
        disputeReason: settlement.disputeReason,
        disputeResolver: settlement.disputeResolver,
        escrowReleaseTime: new Date(settlement.escrowReleaseTime.toNumber() * 1000),
        buyerConfirmed: settlement.buyerConfirmed,
        sellerConfirmed: settlement.sellerConfirmed,
        settlementFee: ethers.utils.formatUnits(settlement.settlementFee, 6),
        feeRecipient: settlement.feeRecipient
      }
    });
  } catch (error) {
    console.error('Error retrieving on-chain settlement:', error);
    res.status(500).json({
      message: 'Failed to retrieve on-chain settlement',
      error: error.message
    });
  }
});

// 4. Retry failed transaction
app.post('/api/transactions/:transactionId/retry', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await ContractTransaction.findById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        message: 'Transaction not found'
      });
    }
    
    if (transaction.status !== 'FAILED') {
      return res.status(400).json({
        message: `Transaction cannot be retried in ${transaction.status} status`
      });
    }
    
    if (transaction.retryCount >= transaction.maxRetries) {
      return res.status(400).json({
        message: 'Maximum retry attempts exceeded'
      });
    }
    
    // Reset transaction status and retry
    transaction.status = 'PENDING';
    transaction.errorMessage = null;
    transaction.retryCount += 1;
    await transaction.save();
    
    // Republish the original event to trigger retry
    const retryEvent = {
      eventType: 'CREATE_SETTLEMENT', // This would be determined by transaction.type
      ...transaction.parameters,
      settlementId: transaction._id.toString()
    };
    
    await publishEvent('settlement-requests', retryEvent);
    
    res.status(200).json({
      message: 'Transaction retry initiated successfully',
      transaction
    });
  } catch (error) {
    console.error('Error retrying transaction:', error);
    res.status(500).json({
      message: 'Failed to retry transaction',
      error: error.message
    });
  }
});

// Server setup
let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Blockchain service running on port ${PORT}`);
    console.log(`Service wallet address: ${serviceWallet.address}`);
  });
}

module.exports = { app, server };
