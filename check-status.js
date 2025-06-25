#!/usr/bin/env node

/**
 * Quick Status Check Script
 * Checks the current state of all services and contracts
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 MARKETPLACE STATUS CHECK');
console.log('============================================================\n');

function checkService(serviceName, servicePath) {
    console.log(`📦 Checking ${serviceName}...`);
    
    try {
        // Check if package.json exists
        const packagePath = path.join(servicePath, 'package.json');
        if (!fs.existsSync(packagePath)) {
            console.log(`  ❌ No package.json found`);
            return false;
        }
        
        // Check if node_modules exists
        const nodeModulesPath = path.join(servicePath, 'node_modules');
        if (!fs.existsSync(nodeModulesPath)) {
            console.log(`  ⚠️  Dependencies not installed`);
            return false;
        }
        
        // Check if main file exists
        const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        const mainFile = path.join(servicePath, package.main || 'server.js');
        if (!fs.existsSync(mainFile)) {
            console.log(`  ❌ Main file not found: ${package.main || 'server.js'}`);
            return false;
        }
        
        console.log(`  ✅ ${serviceName} looks good`);
        return true;
        
    } catch (error) {
        console.log(`  ❌ Error checking ${serviceName}: ${error.message}`);
        return false;
    }
}

function checkContract(contractName) {
    try {
        const contractPath = path.join('contracts', 'contracts', contractName);
        if (fs.existsSync(contractPath)) {
            console.log(`  ✅ ${contractName}`);
            return true;
        } else {
            console.log(`  ❌ ${contractName} not found`);
            return false;
        }
    } catch (error) {
        console.log(`  ❌ Error checking ${contractName}: ${error.message}`);
        return false;
    }
}

// Check Backend Services
console.log('🔍 BACKEND SERVICES STATUS');
console.log('------------------------------------------------------------');

const services = [
    ['Auth Service', 'backend/auth-service'],
    ['User Service', 'backend/user-service'],
    ['Fund Service', 'backend/fund-service'],
    ['Trading Service', 'backend/trading-service'],
    ['Settlement Service', 'backend/settlement-service'],
    ['Blockchain Service', 'backend/blockchain-service'],
    ['Notification Service', 'backend/notification-service']
];

let servicesOk = 0;
services.forEach(([name, path]) => {
    if (checkService(name, path)) servicesOk++;
});

console.log(`\n📊 Backend Services: ${servicesOk}/${services.length} ready\n`);

// Check Oracle Services
console.log('🔍 ORACLE SERVICES STATUS');
console.log('------------------------------------------------------------');

const oracles = [
    ['NAV Oracle', 'backend/oracles/nav-oracle'],
    ['Forex Oracle', 'backend/oracles/forex-oracle'],
    ['Custody Oracle', 'backend/oracles/custody-oracle'],
    ['Market Oracle', 'backend/oracles/market-oracle']
];

let oraclesOk = 0;
oracles.forEach(([name, path]) => {
    if (checkService(name, path)) oraclesOk++;
});

console.log(`\n📊 Oracle Services: ${oraclesOk}/${oracles.length} ready\n`);

// Check Smart Contracts
console.log('🔍 SMART CONTRACTS STATUS');
console.log('------------------------------------------------------------');

const contracts = [
    'FundFactory.sol',
    'FundToken.sol',
    'Marketplace.sol',
    'Settlement.sol',
    'CustodyTracker.sol',
    'MockUSDC.sol'
];

let contractsOk = 0;
contracts.forEach(contract => {
    if (checkContract(contract)) contractsOk++;
});

console.log(`\n📊 Smart Contracts: ${contractsOk}/${contracts.length} available\n`);

// Check Frontend
console.log('🔍 FRONTEND STATUS');
console.log('------------------------------------------------------------');

const frontendPath = 'frontend-basic';
if (fs.existsSync(frontendPath)) {
    console.log(`  ✅ Frontend directory exists`);
    
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        console.log(`  ✅ index.html found`);
    } else {
        console.log(`  ❌ index.html not found`);
    }
    
    const serverPath = path.join(frontendPath, 'server.js');
    if (fs.existsSync(serverPath)) {
        console.log(`  ✅ server.js found`);
    } else {
        console.log(`  ❌ server.js not found`);
    }
} else {
    console.log(`  ❌ Frontend directory not found`);
}

// Summary
console.log('\n🎯 OVERALL STATUS');
console.log('============================================================');
console.log(`✅ Backend Services: ${servicesOk}/${services.length}`);
console.log(`✅ Oracle Services: ${oraclesOk}/${oracles.length}`);
console.log(`✅ Smart Contracts: ${contractsOk}/${contracts.length}`);

const totalServices = services.length + oracles.length;
const totalReady = servicesOk + oraclesOk;
const readyPercentage = Math.round((totalReady / totalServices) * 100);

console.log(`\n🚀 System Ready: ${readyPercentage}%`);

if (readyPercentage >= 80) {
    console.log('\n🎉 System is ready for deployment!');
    console.log('\nNext Steps:');
    console.log('1. Start MongoDB: docker run -d -p 27017:27017 mongo');
    console.log('2. Start Kafka: docker run -d -p 9092:9092 confluentinc/cp-kafka');
    console.log('3. Start Hardhat node: cd contracts && npx hardhat node');
    console.log('4. Deploy contracts: cd contracts && npx hardhat run scripts/deploy-all.js');
    console.log('5. Start services individually or use docker-compose');
} else {
    console.log('\n⚠️  System needs additional setup');
    console.log('Some services are missing dependencies or files');
}

console.log('\n============================================================');
console.log('Status check complete!');
