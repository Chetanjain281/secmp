const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/marketplace';

async function fixDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB successfully');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Check existing indexes
    console.log('\nChecking existing indexes:');
    const indexes = await collection.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));

    // Drop the problematic userId index if it exists
    try {
      console.log('\nAttempting to drop userId_1 index...');
      await collection.dropIndex('userId_1');
      console.log('Successfully dropped userId_1 index');
    } catch (error) {
      if (error.code === 27) {
        console.log('Index userId_1 does not exist (this is expected)');
      } else {
        console.log('Error dropping index:', error.message);
      }
    }

    // Check if there are any documents with userId field
    console.log('\nChecking for documents with userId field...');
    const docsWithUserId = await collection.find({ userId: { $exists: true } }).toArray();
    console.log(`Found ${docsWithUserId.length} documents with userId field`);

    if (docsWithUserId.length > 0) {
      console.log('Removing userId field from existing documents...');
      await collection.updateMany(
        { userId: { $exists: true } },
        { $unset: { userId: "" } }
      );
      console.log('Removed userId field from all documents');
    }

    // List current documents
    console.log('\nCurrent user documents:');
    const allUsers = await collection.find({}).toArray();
    console.log(`Total users: ${allUsers.length}`);
    
    allUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role || 'N/A'}`);
    });

    // Check final indexes
    console.log('\nFinal indexes:');
    const finalIndexes = await collection.indexes();
    console.log('Final indexes:', JSON.stringify(finalIndexes, null, 2));

    console.log('\nDatabase fix completed successfully!');
    
  } catch (error) {
    console.error('Error fixing database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

fixDatabase();
