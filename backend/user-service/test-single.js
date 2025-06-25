const request = require('supertest');
const { app } = require('./server');

// Run only the failing validation tests
async function runValidationTests() {
  console.log('Testing validation of required fields...');
  const invalidProfile = {
    userId: 'user123',
    email: 'test@example.com',
    profile: {
      firstName: '', // Invalid
      lastName: 'Doe',
      country: '' // Invalid
    },
    role: 'investor'
  };

  const response = await request(app)
    .post('/api/profile')
    .send(invalidProfile);
    
  console.log(`Status: ${response.status}`);
  console.log('Response body:', response.body);
  
  console.log('\nTesting validation of wallet address format...');
  const invalidWalletProfile = {
    userId: 'user123',
    email: 'test@example.com',
    profile: {
      firstName: 'John',
      lastName: 'Doe',
      country: 'India',
      walletAddress: 'invalid-address'
    },
    role: 'investor'
  };
  
  const response2 = await request(app)
    .post('/api/profile')
    .send(invalidWalletProfile);
    
  console.log(`Status: ${response2.status}`);
  console.log('Response body:', response2.body);
  
  console.log('\nTesting validation of role...');
  const invalidRoleProfile = {
    userId: 'user123',
    email: 'test@example.com',
    profile: {
      firstName: 'John',
      lastName: 'Doe',
      country: 'India'
    },
    role: 'invalid_role'
  };
  
  const response3 = await request(app)
    .post('/api/profile')
    .send(invalidRoleProfile);
    
  console.log(`Status: ${response3.status}`);
  console.log('Response body:', response3.body);
  
  process.exit();
}

runValidationTests();
