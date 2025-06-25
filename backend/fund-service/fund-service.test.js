const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('./server');

// Test database
const MONGODB_TEST_URI = 'mongodb://localhost:27017/marketplace_test';

describe('Fund Service Tests', () => {
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
        service: 'fund-service',
        mongodb: 'connected'
      });
    });
  });

  describe('Fund CRUD Operations', () => {
    const validFund = {
      name: 'Test Equity Fund',
      symbol: 'TEF',
      description: 'A test equity fund for unit testing',
      fundType: 'private_equity',
      managerId: '60d0fe4f5311236168a109ca', // Mock ObjectId
      managerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
      currentNAV: 100,
      minimumInvestment: 5000,
      suitabilityCriteria: {
        minIncomeLevel: '1Cr_5Cr',
        minExperience: 'intermediate',
        allowedRiskTolerance: ['moderate', 'aggressive'],
        allowedGeography: ['India', 'Singapore']
      }
    };

    test('POST /api/funds should create new fund', async () => {
      const response = await request(app)
        .post('/api/funds')
        .send(validFund);

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Fund created successfully');
      expect(response.body.fund.name).toBe(validFund.name);
      expect(response.body.fund.symbol).toBe(validFund.symbol);
      expect(response.body.fund.status).toBe('draft');
    });

    test('POST /api/funds should validate required fields', async () => {
      const invalidFund = {
        name: '', // Invalid
        symbol: 'TST',
        description: 'Test fund',
        fundType: 'invalid_type', // Invalid
        managerId: '60d0fe4f5311236168a109ca',
        managerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        currentNAV: 100,
        minimumInvestment: 5000
      };

      const response = await request(app)
        .post('/api/funds')
        .send(invalidFund);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThanOrEqual(2);
    });

    test('GET /api/funds should return all funds', async () => {
      // Create test funds
      await request(app).post('/api/funds').send({
        ...validFund,
        name: 'Fund 1',
        symbol: 'FND1'
      });

      await request(app).post('/api/funds').send({
        ...validFund,
        name: 'Fund 2',
        symbol: 'FND2'
      });

      const response = await request(app).get('/api/funds');

      expect(response.status).toBe(200);
      expect(response.body.funds.length).toBe(2);
      expect(response.body.totalFunds).toBe(2);
    });

    test('GET /api/funds should filter by fund type', async () => {
      // Create test funds
      await request(app).post('/api/funds').send({
        ...validFund,
        name: 'Equity Fund',
        symbol: 'EQF',
        fundType: 'private_equity'
      });

      await request(app).post('/api/funds').send({
        ...validFund,
        name: 'Real Estate Fund',
        symbol: 'REF',
        fundType: 'real_estate'
      });

      const response = await request(app)
        .get('/api/funds')
        .query({ fundType: 'private_equity' });

      expect(response.status).toBe(200);
      expect(response.body.funds.length).toBe(1);
      expect(response.body.funds[0].name).toBe('Equity Fund');
    });

    test('GET /api/funds/:fundId should return fund details', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      const response = await request(app).get(`/api/funds/${fundId}`);

      expect(response.status).toBe(200);
      expect(response.body.fund.name).toBe(validFund.name);
      expect(response.body.fund.symbol).toBe(validFund.symbol);
    });

    test('PUT /api/funds/:fundId should update fund details', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      const updates = {
        name: 'Updated Fund Name',
        description: 'Updated description'
      };

      const response = await request(app)
        .put(`/api/funds/${fundId}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body.fund.name).toBe(updates.name);
      expect(response.body.fund.description).toBe(updates.description);
      expect(response.body.fund.symbol).toBe(validFund.symbol); // Unchanged
    });
  });

  describe('Fund Workflow', () => {
    const validFund = {
      name: 'Workflow Test Fund',
      symbol: 'WTF',
      description: 'A test fund for workflow testing',
      fundType: 'hedge_fund',
      managerId: '60d0fe4f5311236168a109ca', // Mock ObjectId
      managerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
      currentNAV: 100,
      minimumInvestment: 10000,
      suitabilityCriteria: {
        minIncomeLevel: '5Cr_plus',
        minExperience: 'expert',
        allowedRiskTolerance: ['aggressive'],
        allowedGeography: ['India', 'Singapore', 'USA']
      }
    };

    test('POST /api/funds/:fundId/submit should require offering memorandum', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      const response = await request(app)
        .post(`/api/funds/${fundId}/submit`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Offering memorandum is required');
    });

    test('POST /api/funds/:fundId/review should approve fund', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      // Mock document upload
      // In a real test, we would use FormData and attach a file
      // For now, let's update the fund directly in the test
      const Fund = mongoose.model('Fund');
      await Fund.findByIdAndUpdate(fundId, {
        $push: {
          documents: {
            type: 'offering_memorandum',
            filename: 'test-document.pdf',
            uploadedAt: new Date()
          }
        }
      });

      // Submit fund
      await request(app).post(`/api/funds/${fundId}/submit`);

      // Review and approve
      const response = await request(app)
        .post(`/api/funds/${fundId}/review`)
        .send({
          status: 'active',
          reviewedBy: 'admin123'
        });

      expect(response.status).toBe(200);
      expect(response.body.fund.status).toBe('active');
    });

    test('POST /api/funds/:fundId/review should reject fund with reason', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      // Add document and submit
      const Fund = mongoose.model('Fund');
      await Fund.findByIdAndUpdate(fundId, {
        $push: {
          documents: {
            type: 'offering_memorandum',
            filename: 'test-document.pdf',
            uploadedAt: new Date()
          }
        }
      });
      
      await request(app).post(`/api/funds/${fundId}/submit`);

      // Review and reject
      const response = await request(app)
        .post(`/api/funds/${fundId}/review`)
        .send({
          status: 'rejected',
          reviewedBy: 'admin123',
          rejectionReason: 'Insufficient documentation'
        });

      expect(response.status).toBe(200);
      expect(response.body.fund.status).toBe('rejected');
      expect(response.body.fund.rejectionReason).toBe('Insufficient documentation');
    });

    test('POST /api/funds/:fundId/nav should update NAV', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      const response = await request(app)
        .post(`/api/funds/${fundId}/nav`)
        .send({ nav: 105.50 });

      expect(response.status).toBe(200);
      expect(response.body.fund.currentNAV).toBe(105.50);

      // Check NAV history
      const historyResponse = await request(app).get(`/api/funds/${fundId}/nav/history`);
      
      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.history.length).toBe(2); // Initial + update
      expect(historyResponse.body.history[1].nav).toBe(105.50);
    });    test('POST /api/funds/:fundId/deploy should deploy active fund with token supply', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      // Add document, submit and approve
      const Fund = mongoose.model('Fund');
      await Fund.findByIdAndUpdate(fundId, {
        $push: {
          documents: {
            type: 'offering_memorandum',
            filename: 'test-document.pdf',
            uploadedAt: new Date()
          }
        }
      });
      
      const initialSupply = 1000000;
      
      await request(app).post(`/api/funds/${fundId}/submit`);
      
      await request(app)
        .post(`/api/funds/${fundId}/review`)
        .send({
          status: 'active',
          reviewedBy: 'admin123'
        });      // Deploy fund with token supply
      const response = await request(app)
        .post(`/api/funds/${fundId}/deploy`)
        .send({ initialSupply });

      expect(response.status).toBe(200);
      expect(response.body.fund.totalSupply).toBe(initialSupply);
      expect(response.body.fund.availableTokens).toBe(initialSupply);
      expect(response.body.message).toBe('Fund deployed to blockchain');
      expect(response.body.fund.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test('POST /api/funds/:fundId/deploy should require initial supply', async () => {
      // Create a fund
      const createResponse = await request(app)
        .post('/api/funds')
        .send(validFund);
      
      const fundId = createResponse.body.fund._id;

      // Add document, submit and approve
      const Fund = mongoose.model('Fund');
      await Fund.findByIdAndUpdate(fundId, {
        $push: {
          documents: {
            type: 'offering_memorandum',
            filename: 'test-document.pdf',
            uploadedAt: new Date()
          }
        }
      });
      
      await request(app).post(`/api/funds/${fundId}/submit`);
      
      await request(app)
        .post(`/api/funds/${fundId}/review`)
        .send({
          status: 'active',
          reviewedBy: 'admin123'
        });

      // Try to deploy fund without providing initialSupply
      const response = await request(app)
        .post(`/api/funds/${fundId}/deploy`);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Valid initial token supply is required');
    });
  });

  describe('Error Handling', () => {
    test('GET /api/funds/:fundId should return 404 for non-existent fund', async () => {
      const response = await request(app)
        .get('/api/funds/60d0fe4f5311236168a109ca'); // Valid ObjectId format but doesn't exist

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Fund not found');
    });

    test('PUT /api/funds/:fundId should return 404 for non-existent fund', async () => {
      const response = await request(app)
        .put('/api/funds/60d0fe4f5311236168a109ca')
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Fund not found');
    });

    test('POST /api/funds should prevent duplicate symbols', async () => {
      const fund = {
        name: 'Test Fund 1',
        symbol: 'TF1',
        description: 'Test fund',
        fundType: 'private_equity',
        managerId: '60d0fe4f5311236168a109ca',
        managerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
        currentNAV: 100,
        minimumInvestment: 5000
      };

      // Create first fund
      await request(app).post('/api/funds').send(fund);

      // Try to create another with same symbol
      const response = await request(app)
        .post('/api/funds')
        .send({
          ...fund,
          name: 'Test Fund 2' // Different name, same symbol
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Fund symbol already in use');
    });
  });

  describe('Fund Pause/Unpause', () => {
    const validFund = {
      name: 'Pause Test Fund',
      symbol: 'PTF',
      description: 'A test fund for pause/unpause testing',
      fundType: 'hedge_fund',
      managerId: '60d0fe4f5311236168a109ca', // Mock ObjectId
      managerWalletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1',
      currentNAV: 100,
      minimumInvestment: 10000,
      suitabilityCriteria: {
        minIncomeLevel: '5Cr_plus',
        minExperience: 'expert',
        allowedRiskTolerance: ['aggressive'],
        allowedGeography: ['India', 'Singapore', 'USA']
      }
    };

    test('PATCH /api/funds/:fundId/status should pause an active fund', async () => {
      // First create a fund
      const response = await request(app)
        .post('/api/funds')
        .send(validFund);
    
      const fundId = response.body.fund._id;
      
      // Update to active status
      await Fund.findByIdAndUpdate(fundId, { status: 'active' });
      
      // Now pause the fund
      const pauseResponse = await request(app)
        .patch(`/api/funds/${fundId}/status`)
        .send({ action: 'pause' });
    
      expect(pauseResponse.status).toBe(200);
      expect(pauseResponse.body.message).toBe('Fund paused successfully');
      expect(pauseResponse.body.fund.status).toBe('paused');
    });
    
    test('PATCH /api/funds/:fundId/status should unpause a paused fund', async () => {
      // First create a fund
      const response = await request(app)
        .post('/api/funds')
        .send(validFund);
    
      const fundId = response.body.fund._id;
      
      // Update to paused status
      await Fund.findByIdAndUpdate(fundId, { status: 'paused' });
      
      // Now unpause the fund
      const unpauseResponse = await request(app)
        .patch(`/api/funds/${fundId}/status`)
        .send({ action: 'unpause' });
    
      expect(unpauseResponse.status).toBe(200);
      expect(unpauseResponse.body.message).toBe('Fund unpaused successfully');
      expect(unpauseResponse.body.fund.status).toBe('active');
    });
    
    test('PATCH /api/funds/:fundId/status should validate fund status for pause action', async () => {
      // First create a fund
      const response = await request(app)
        .post('/api/funds')
        .send(validFund);
    
      const fundId = response.body.fund._id;
      
      // Fund is in draft status by default
      
      // Try to pause a non-active fund
      const pauseResponse = await request(app)
        .patch(`/api/funds/${fundId}/status`)
        .send({ action: 'pause' });
    
      expect(pauseResponse.status).toBe(400);
      expect(pauseResponse.body.message).toBe('Only active funds can be paused');
    });

    test('PATCH /api/funds/:fundId/status should validate fund status for unpause action', async () => {
      // First create a fund
      const response = await request(app)
        .post('/api/funds')
        .send(validFund);
    
      const fundId = response.body.fund._id;
      
      // Update to active status
      await Fund.findByIdAndUpdate(fundId, { status: 'active' });
      
      // Try to unpause an active fund
      const unpauseResponse = await request(app)
        .patch(`/api/funds/${fundId}/status`)
        .send({ action: 'unpause' });
    
      expect(unpauseResponse.status).toBe(400);
      expect(unpauseResponse.body.message).toBe('Only paused funds can be unpaused');
    });
  });
});

module.exports = {};
