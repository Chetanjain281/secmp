// Jest setup for settlement service
const { MongoMemoryServer } = require('mongodb-memory-server');

// Increase timeout for database operations
jest.setTimeout(30000);

// Mock Kafka to prevent actual connections during testing
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      send: jest.fn().mockResolvedValue()
    }),
    consumer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      subscribe: jest.fn().mockResolvedValue(),
      run: jest.fn().mockResolvedValue()
    })
  }))
}));

// Mock Web3 to prevent actual blockchain connections during testing
jest.mock('web3', () => {
  return jest.fn().mockImplementation(() => ({
    eth: {
      getBlockNumber: jest.fn().mockResolvedValue(12345),
      getGasPrice: jest.fn().mockResolvedValue('20000000000'),
      getTransactionReceipt: jest.fn().mockResolvedValue({
        blockNumber: 12345,
        gasUsed: 150000,
        status: true
      })
    }
  }));
});

// Suppress console logs during testing unless debugging
if (process.env.NODE_ENV === 'test' && !process.env.DEBUG_TESTS) {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
}

// Global test variables
global.mongoServer = null;

// Setup before all tests
beforeAll(async () => {
  // Create in-memory MongoDB instance
  global.mongoServer = await MongoMemoryServer.create();
});

// Cleanup after all tests
afterAll(async () => {
  if (global.mongoServer) {
    await global.mongoServer.stop();
  }
});

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/marketplace-test';
process.env.KAFKA_BROKER = 'localhost:9092';
process.env.WEB3_PROVIDER = 'http://localhost:8545';
process.env.PORT = '3015';
