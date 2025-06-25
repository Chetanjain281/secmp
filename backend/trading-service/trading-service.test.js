const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('./server');

// Test database
const MONGODB_TEST_URI = 'mongodb://localhost:27017/marketplace_test';

// Mock data
const mockOrder = {
  userId: '60d0fe4f5311236168a109ca', // Mock ObjectId
  fundId: '60d0fe4f5311236168a109cb', // Mock ObjectId
  orderType: 'BUY',
  marketType: 'SECONDARY',
  tokenAmount: 100,
  pricePerToken: 10.5,
  walletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1'
};

describe('Trading Service Tests', () => {
  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(MONGODB_TEST_URI);
  });

  beforeEach(async () => {
    // Clear test database before each test
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (server) {
      server.close();
    }
  });

  describe('Health Check', () => {
    test('GET /health should return service status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'trading-service',
        mongodb: 'connected'
      });
    });
  });

  describe('Order Operations', () => {
    test('POST /api/orders should create a new order', async () => {
      const response = await request(app)
        .post('/api/orders')
        .send(mockOrder);
      
      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Order created successfully');
      expect(response.body.order).toMatchObject({
        userId: mockOrder.userId,
        fundId: mockOrder.fundId,
        orderType: mockOrder.orderType,
        marketType: mockOrder.marketType,
        tokenAmount: mockOrder.tokenAmount,
        pricePerToken: mockOrder.pricePerToken,
        totalAmount: mockOrder.tokenAmount * mockOrder.pricePerToken,
        status: 'PENDING'
      });
    });

    test('POST /api/orders should validate required fields', async () => {
      const invalidOrder = {
        fundId: '60d0fe4f5311236168a109cb',
        orderType: 'INVALID', // Invalid enum value
        tokenAmount: 100,
        pricePerToken: 10.5,
        walletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1'
      };

      const response = await request(app)
        .post('/api/orders')
        .send(invalidOrder);
      
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    test('GET /api/orders should return all orders', async () => {
      // Create test orders
      await request(app).post('/api/orders').send(mockOrder);
      
      const sellOrder = {
        ...mockOrder,
        orderType: 'SELL'
      };
      await request(app).post('/api/orders').send(sellOrder);

      const response = await request(app).get('/api/orders');
      
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Orders retrieved successfully');
      expect(response.body.orders).toHaveLength(2);
    });

    test('GET /api/orders/:orderId should return a specific order', async () => {
      // Create an order
      const createResponse = await request(app)
        .post('/api/orders')
        .send(mockOrder);
      
      const orderId = createResponse.body.order._id;
      
      const response = await request(app).get(`/api/orders/${orderId}`);
      
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Order retrieved successfully');
      expect(response.body.order._id).toBe(orderId);
    });

    test('PATCH /api/orders/:orderId/cancel should cancel an order', async () => {
      // Create an order
      const createResponse = await request(app)
        .post('/api/orders')
        .send(mockOrder);
      
      const orderId = createResponse.body.order._id;
      
      const response = await request(app)
        .patch(`/api/orders/${orderId}/cancel`);
      
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Order cancelled successfully');
      expect(response.body.order.status).toBe('CANCELLED');
    });
  });

  describe('Order Book', () => {
    test('GET /api/funds/:fundId/orderbook should return the order book', async () => {
      const fundId = '60d0fe4f5311236168a109cb';

      // Create multiple buy and sell orders
      await request(app).post('/api/orders').send({
        ...mockOrder,
        fundId,
        orderType: 'BUY',
        pricePerToken: 10.0
      });

      await request(app).post('/api/orders').send({
        ...mockOrder,
        fundId,
        orderType: 'BUY',
        pricePerToken: 10.5
      });

      await request(app).post('/api/orders').send({
        ...mockOrder,
        fundId,
        orderType: 'SELL',
        pricePerToken: 11.0
      });

      await request(app).post('/api/orders').send({
        ...mockOrder,
        fundId,
        orderType: 'SELL',
        pricePerToken: 11.5
      });

      const response = await request(app).get(`/api/funds/${fundId}/orderbook`);
      
      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Order book retrieved successfully');
      expect(response.body.fundId).toBe(fundId);
      expect(response.body.bids).toBeDefined();
      expect(response.body.asks).toBeDefined();
      expect(response.body.bids.length).toBe(2);
      expect(response.body.asks.length).toBe(2);
    });
  });

  describe('Order Matching', () => {
    test('Should match buy and sell orders when prices overlap', async () => {
      const fundId = '60d0fe4f5311236168a109cb';
      
      // Create a sell order
      const sellResponse = await request(app).post('/api/orders').send({
        userId: '60d0fe4f5311236168a109cd', // Different user
        fundId,
        orderType: 'SELL',
        marketType: 'SECONDARY',
        tokenAmount: 50,
        pricePerToken: 10.0, // Willing to sell at 10.0
        walletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1'
      });
      
      // Small delay to ensure order processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create a buy order with higher price (should match)
      const buyResponse = await request(app).post('/api/orders').send({
        ...mockOrder,
        fundId,
        orderType: 'BUY',
        pricePerToken: 10.5, // Willing to buy at 10.5
      });
      
      // Small delay to ensure matching happens
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Check updated buy order status
      const buyOrderCheck = await request(app).get(`/api/orders/${buyResponse.body.order._id}`);
      expect(buyOrderCheck.body.order.status).toBe('PARTIAL');
      expect(buyOrderCheck.body.order.filledAmount).toBe(50);
      
      // Check updated sell order status
      const sellOrderCheck = await request(app).get(`/api/orders/${sellResponse.body.order._id}`);
      expect(sellOrderCheck.body.order.status).toBe('COMPLETED');
      expect(sellOrderCheck.body.order.filledAmount).toBe(50);
      
      // Check that a trade was created
      const tradesResponse = await request(app).get('/api/trades');
      expect(tradesResponse.body.trades.length).toBe(1);
      expect(tradesResponse.body.trades[0].buyOrderId).toBe(buyResponse.body.order._id);
      expect(tradesResponse.body.trades[0].sellOrderId).toBe(sellResponse.body.order._id);
      expect(tradesResponse.body.trades[0].pricePerToken).toBe(10.0); // Should use sell price
    });
  });
});
