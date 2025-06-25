// Jest setup file
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/marketplace_test';
process.env.PORT = 3013; // Different port for tests

// Mock multer middleware
jest.mock('multer', () => {
  const multerMock = () => ({
    single: () => (req, res, next) => {
      req.file = {
        fieldname: 'document',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        filename: `${Date.now()}-test.pdf`,
        path: 'uploads/test.pdf',
        size: 1000
      };
      next();
    },
    array: () => (req, res, next) => {
      req.files = [
        {
          fieldname: 'company_registration',
          originalname: 'registration.pdf',
          mimetype: 'application/pdf',
          filename: `${Date.now()}-registration.pdf`,
          path: 'uploads/registration.pdf',
          size: 1000
        }
      ];
      next();
    }
  });
  multerMock.diskStorage = () => ({});
  return multerMock;
});

// Ensure the uploads directory exists
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
