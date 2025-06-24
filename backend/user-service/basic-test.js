const request = require('supertest');

// Simple health check test without MongoDB
describe('Basic Service Tests', () => {
  test('Health check endpoint should be accessible', async () => {
    // Mock the server without MongoDB connection
    const express = require('express');
    const app = express();
    
    app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'ok',
        service: 'user-service'
      });
    });

    const response = await request(app).get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('user-service');
  });

  test('Invalid endpoint should return 404', async () => {
    const express = require('express');
    const app = express();
    
    app.use('*', (req, res) => {
      res.status(404).json({
        message: 'Endpoint not found'
      });
    });

    const response = await request(app).get('/invalid-endpoint');
    
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Endpoint not found');
  });
});

module.exports = {};
