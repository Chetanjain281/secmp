const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../server');

describe('Settlement Service', () => {
  let mongoServer;
  let mongoUri;

  beforeAll(async () => {
    // Start in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    mongoUri = mongoServer.getUri();
    
    // Connect to the in-memory database
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    // Cleanup
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  });

  describe('Health Check', () => {
    test('GET /health should return service status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('service', 'settlement-service');
      expect(response.body).toHaveProperty('mongodb');
      expect(response.body).toHaveProperty('kafka');
    });
  });

  describe('Settlement API Endpoints', () => {
    test('GET /api/settlements should return empty array initially', async () => {
      const response = await request(app)
        .get('/api/settlements')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Settlements retrieved successfully');
      expect(response.body).toHaveProperty('settlements');
      expect(response.body.settlements).toEqual([]);
      expect(response.body).toHaveProperty('totalSettlements', 0);
    });

    test('GET /api/settlements should support pagination', async () => {
      const response = await request(app)
        .get('/api/settlements?page=1&limit=5')
        .expect(200);

      expect(response.body).toHaveProperty('currentPage', 1);
      expect(response.body).toHaveProperty('totalPages');
      expect(response.body).toHaveProperty('totalSettlements');
    });

    test('GET /api/settlements should support status filtering', async () => {
      const response = await request(app)
        .get('/api/settlements?status=Pending')
        .expect(200);

      expect(response.body).toHaveProperty('settlements');
    });

    test('GET /api/settlements/:settlementId should return 404 for non-existent settlement', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .get(`/api/settlements/${nonExistentId}`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Settlement not found');
    });

    test('POST /api/settlements/:settlementId/retry should return 404 for non-existent settlement', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .post(`/api/settlements/${nonExistentId}/retry`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Settlement not found');
    });
  });

  describe('Settlement Processing', () => {
    const Settlement = mongoose.model('Settlement');

    test('should create settlement with correct schema', async () => {
      const settlementData = {
        tradeId: new mongoose.Types.ObjectId(),
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 1,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 100,
        paymentAmount: 1050,
        settlementDate: new Date(),
        status: 'Pending'
      };

      const settlement = new Settlement(settlementData);
      await settlement.save();

      expect(settlement._id).toBeDefined();
      expect(settlement.status).toBe('Pending');
      expect(settlement.disputeStatus).toBe('None');
      expect(settlement.buyerConfirmed).toBe(false);
      expect(settlement.sellerConfirmed).toBe(false);
      expect(settlement.escrowReleaseTime).toBeDefined();
    });

    test('should calculate settlement fee correctly', async () => {
      const paymentAmount = 1000;
      const expectedFee = (paymentAmount * 25) / 10000; // 0.25%

      const settlement = new Settlement({
        tradeId: new mongoose.Types.ObjectId(),
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 1,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 100,
        paymentAmount: paymentAmount,
        settlementDate: new Date(),
        settlementFee: expectedFee
      });

      await settlement.save();
      expect(settlement.settlementFee).toBe(expectedFee);
    });

    test('should validate required fields', async () => {
      const invalidSettlement = new Settlement({
        // Missing required fields
        tokenAmount: 100
      });

      await expect(invalidSettlement.save()).rejects.toThrow();
    });

    test('should validate enum values for status', async () => {
      const settlement = new Settlement({
        tradeId: new mongoose.Types.ObjectId(),
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 1,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 100,
        paymentAmount: 1050,
        settlementDate: new Date(),
        status: 'InvalidStatus' // Invalid enum value
      });

      await expect(settlement.save()).rejects.toThrow();
    });

    test('should validate enum values for disputeStatus', async () => {
      const settlement = new Settlement({
        tradeId: new mongoose.Types.ObjectId(),
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 1,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 100,
        paymentAmount: 1050,
        settlementDate: new Date(),
        disputeStatus: 'InvalidDispute' // Invalid enum value
      });

      await expect(settlement.save()).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed settlement ID in GET request', async () => {
      const response = await request(app)
        .get('/api/settlements/invalid-id')
        .expect(500);

      expect(response.body).toHaveProperty('message', 'Failed to retrieve settlement');
      expect(response.body).toHaveProperty('error');
    });

    test('should handle malformed settlement ID in retry request', async () => {
      const response = await request(app)
        .post('/api/settlements/invalid-id/retry')
        .expect(500);

      expect(response.body).toHaveProperty('message', 'Failed to retry settlement');
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Settlement Schema Indexes', () => {
    const Settlement = mongoose.model('Settlement');

    test('should have unique index on tradeId', async () => {
      const tradeId = new mongoose.Types.ObjectId();
      
      const settlement1 = new Settlement({
        tradeId: tradeId,
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 1,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b2',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 100,
        paymentAmount: 1050,
        settlementDate: new Date()
      });

      const settlement2 = new Settlement({
        tradeId: tradeId, // Same tradeId
        buyOrderId: new mongoose.Types.ObjectId(),
        sellOrderId: new mongoose.Types.ObjectId(),
        fundId: new mongoose.Types.ObjectId(),
        settlementId: 2,
        buyer: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b3',
        seller: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b4',
        fundToken: '0x1234567890123456789012345678901234567890',
        paymentToken: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        tokenAmount: 50,
        paymentAmount: 525,
        settlementDate: new Date()
      });

      await settlement1.save();
      await expect(settlement2.save()).rejects.toThrow();
    });
  });
});
