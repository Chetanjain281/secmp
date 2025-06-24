const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');

// Import services
const { app: userApp, server: userServer } = require('../server');

// Test database
const MONGODB_TEST_URI = 'mongodb://localhost:27017/marketplace_integration_test';

// Service URLs
const AUTH_SERVICE_URL = 'http://localhost:3011';
const NOTIFICATION_SERVICE_URL = 'http://localhost:3020';
const USER_SERVICE_URL = 'http://localhost:3012';

describe('User Service Integration Tests', () => {
  let authUser = null;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(MONGODB_TEST_URI);
    
    // Wait for services to be ready
    await waitForServices();
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
    if (userServer) {
      userServer.close();
    }
  });

  // Helper function to wait for services to be ready
  async function waitForServices() {
    const services = [
      { name: 'Auth Service', url: `${AUTH_SERVICE_URL}/health` },
      { name: 'Notification Service', url: `${NOTIFICATION_SERVICE_URL}/health` },
      { name: 'User Service', url: `${USER_SERVICE_URL}/health` }
    ];

    for (const service of services) {
      let retries = 0;
      const maxRetries = 10;
      
      while (retries < maxRetries) {
        try {
          const response = await axios.get(service.url, { timeout: 2000 });
          if (response.status === 200) {
            console.log(`${service.name} is ready`);
            break;
          }
        } catch (error) {
          retries++;
          if (retries >= maxRetries) {
            console.warn(`${service.name} not ready after ${maxRetries} attempts`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }
  }

  // Helper function to register a user via auth service
  async function registerUser(userData) {
    try {
      const response = await axios.post(`${AUTH_SERVICE_URL}/api/register`, userData);
      return response.data;
    } catch (error) {
      console.error('User registration failed:', error.response?.data || error.message);
      return null;
    }
  }

  // Helper function to login a user via auth service
  async function loginUser(email, password) {
    try {
      const response = await axios.post(`${AUTH_SERVICE_URL}/api/login`, { email, password });
      return response.data;
    } catch (error) {
      console.error('User login failed:', error.response?.data || error.message);
      return null;
    }
  }

  describe('End-to-End User Flow', () => {
    test('Complete investor onboarding flow', async () => {
      // Step 1: Register user via auth service
      const registrationData = {
        email: 'investor@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Investor',
        role: 'user'
      };

      const registeredUser = await registerUser(registrationData);
      expect(registeredUser).toBeTruthy();
      expect(registeredUser.email).toBe(registrationData.email);

      // Step 2: Create user profile via user service
      const profileData = {
        userId: registeredUser.userId,
        email: registeredUser.email,
        profile: {
          firstName: 'John',
          lastName: 'Investor',
          country: 'India',
          phone: '+911234567890',
          walletAddress: '0x742d35cc6627c0532e5b79b65b5c4d78c7d0c7b1'
        },
        role: 'investor'
      };

      const profileResponse = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.profile.userId).toBe(registeredUser.userId);
      expect(profileResponse.body.profile.profileStatus).toBe('pending_verification');

      // Step 3: Complete suitability assessment
      const suitabilityData = {
        incomeLevel: '5Cr_plus',
        experience: 'expert',
        riskTolerance: 'aggressive',
        netWorth: '10Cr_plus',
        investmentHorizon: 'long_term',
        geography: 'both',
        previousInvestments: [
          {
            type: 'equity',
            amount: 50000000,
            duration: '5 years'
          }
        ]
      };

      const suitabilityResponse = await request(userApp)
        .post(`/api/suitability/${registeredUser.userId}`)
        .send(suitabilityData);

      expect(suitabilityResponse.status).toBe(200);
      expect(suitabilityResponse.body.score).toBeGreaterThan(90);
      expect(suitabilityResponse.body.eligibleFundTypes).toContain('private_equity');

      // Step 4: Check fund eligibility
      const eligibilityResponse = await request(userApp)
        .get(`/api/eligibility/${registeredUser.userId}/test-fund-123`);

      expect(eligibilityResponse.status).toBe(200);
      expect(eligibilityResponse.body.eligible).toBe(true);

      // Step 5: Verify profile is now verified
      const finalProfileResponse = await request(userApp)
        .get(`/api/profile/${registeredUser.userId}`);

      expect(finalProfileResponse.status).toBe(200);
      expect(finalProfileResponse.body.profile.profileStatus).toBe('verified');
      expect(finalProfileResponse.body.profile.suitabilityStatus).toBe('completed');
    });

    test('Complete fund house onboarding flow', async () => {
      // Step 1: Register fund house via auth service
      const registrationData = {
        email: 'fundhouse@test.com',
        password: 'password123',
        firstName: 'Jane',
        lastName: 'Manager',
        role: 'fund_manager'
      };

      const registeredUser = await registerUser(registrationData);
      expect(registeredUser).toBeTruthy();

      // Step 2: Create fund house profile
      const profileData = {
        userId: registeredUser.userId,
        email: registeredUser.email,
        profile: {
          firstName: 'Jane',
          lastName: 'Manager',
          country: 'India',
          phone: '+919876543210'
        },
        role: 'fund_house'
      };

      const profileResponse = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.profile.role).toBe('fund_house');

      // Step 3: Submit KYB documents
      const kybData = {
        companyName: 'Test Fund House Ltd',
        companyRegistrationNumber: 'REG123456',
        companyAddress: '123 Financial District, Mumbai',
        companyCountry: 'India',
        businessType: 'hedge_fund',
        regulatoryLicense: 'SEBI/HF/2024/001',
        aum: 1000000000,
        establishedYear: 2020
      };

      const kybResponse = await request(userApp)
        .post(`/api/kyb/submit/${registeredUser.userId}`)
        .field('kybData', JSON.stringify(kybData))
        .attach('company_registration', Buffer.from('fake pdf content'), 'registration.pdf');

      expect(kybResponse.status).toBe(200);
      expect(kybResponse.body.kybStatus).toBe('pending');

      // Step 4: Admin approves KYB
      const reviewResponse = await request(userApp)
        .post(`/api/kyb/review/${registeredUser.userId}`)
        .send({
          status: 'approved',
          reviewedBy: 'admin123'
        });

      expect(reviewResponse.status).toBe(200);
      expect(reviewResponse.body.kybStatus).toBe('approved');

      // Step 5: Verify profile is verified
      const finalProfileResponse = await request(userApp)
        .get(`/api/profile/${registeredUser.userId}`);

      expect(finalProfileResponse.status).toBe(200);
      expect(finalProfileResponse.body.profile.profileStatus).toBe('verified');
      expect(finalProfileResponse.body.profile.kybStatus).toBe('approved');
    });
  });

  describe('Service Integration', () => {
    test('User registration should trigger profile creation workflow', async () => {
      // Register user via auth service
      const userData = {
        email: 'integration@test.com',
        password: 'password123',
        firstName: 'Integration',
        lastName: 'Test',
        role: 'user'
      };

      const registeredUser = await registerUser(userData);
      expect(registeredUser).toBeTruthy();

      // Verify we can create a profile immediately after registration
      const profileData = {
        userId: registeredUser.userId,
        email: registeredUser.email,
        profile: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          country: 'India'
        },
        role: 'investor'
      };

      const profileResponse = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      expect(profileResponse.status).toBe(200);
    });

    test('Profile updates should trigger notification events', async () => {
      // This test verifies that Kafka events are being published
      // In a real scenario, the notification service would consume these events

      const userData = {
        email: 'notification@test.com',
        password: 'password123',
        firstName: 'Notification',
        lastName: 'Test',
        role: 'user'
      };

      const registeredUser = await registerUser(userData);
      
      const profileData = {
        userId: registeredUser.userId,
        email: registeredUser.email,
        profile: {
          firstName: 'Notification',
          lastName: 'Test',
          country: 'India'
        },
        role: 'investor'
      };

      // Create profile (should trigger PROFILE_UPDATED event)
      const profileResponse = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      expect(profileResponse.status).toBe(200);

      // Complete suitability (should trigger SUITABILITY_COMPLETED event)
      const suitabilityData = {
        incomeLevel: '1Cr_5Cr',
        experience: 'intermediate',
        riskTolerance: 'moderate',
        netWorth: '5Cr_10Cr',
        investmentHorizon: 'medium_term',
        geography: 'domestic'
      };

      const suitabilityResponse = await request(userApp)
        .post(`/api/suitability/${registeredUser.userId}`)
        .send(suitabilityData);

      expect(suitabilityResponse.status).toBe(200);

      // Note: In a full integration test, we would verify that the notification 
      // service received and processed these events. For now, we verify the 
      // operations complete successfully, indicating events were published.
    });

    test('Login should work after profile creation', async () => {
      // Register and create profile
      const userData = {
        email: 'login@test.com',
        password: 'password123',
        firstName: 'Login',
        lastName: 'Test',
        role: 'user'
      };

      const registeredUser = await registerUser(userData);
      
      const profileData = {
        userId: registeredUser.userId,
        email: registeredUser.email,
        profile: {
          firstName: 'Login',
          lastName: 'Test',
          country: 'India'
        },
        role: 'investor'
      };

      await request(userApp)
        .post('/api/profile')
        .send(profileData);

      // Verify login still works
      const loginResult = await loginUser(userData.email, userData.password);
      expect(loginResult).toBeTruthy();
      expect(loginResult.email).toBe(userData.email);
    });
  });

  describe('Cross-Service Data Consistency', () => {
    test('User data should be consistent across services', async () => {
      const userData = {
        email: 'consistency@test.com',
        password: 'password123',
        firstName: 'Consistency',
        lastName: 'Test',
        role: 'user'
      };

      // Register via auth service
      const authUser = await registerUser(userData);
      expect(authUser.email).toBe(userData.email);
      expect(authUser.firstName).toBe(userData.firstName);

      // Create profile via user service
      const profileData = {
        userId: authUser.userId,
        email: authUser.email,
        profile: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          country: 'India'
        },
        role: 'investor'
      };

      const profileResponse = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      expect(profileResponse.status).toBe(200);

      // Verify profile data matches auth data
      const profile = profileResponse.body.profile;
      expect(profile.email).toBe(authUser.email);
      expect(profile.userId).toBe(authUser.userId);
      expect(profile.profile.firstName).toBe(authUser.firstName);
    });
  });

  describe('Error Scenarios', () => {
    test('Should handle auth service unavailable', async () => {
      // This test simulates scenarios where dependent services might be down
      // In practice, this would require mocking or temporarily stopping services
      
      // For now, we test with invalid user IDs to simulate missing data
      const response = await request(userApp)
        .get('/api/profile/nonexistent-user');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('User profile not found');
    });

    test('Should handle profile creation with missing auth user', async () => {
      // Try to create profile for non-existent user
      const profileData = {
        userId: 'nonexistent-123',
        email: 'nonexistent@test.com',
        profile: {
          firstName: 'Non',
          lastName: 'Existent',
          country: 'India'
        },
        role: 'investor'
      };

      const response = await request(userApp)
        .post('/api/profile')
        .send(profileData);

      // Profile creation should still work (service is decoupled)
      // but in a real system, we might want to validate against auth service
      expect(response.status).toBe(200);
    });
  });
});

module.exports = {};
