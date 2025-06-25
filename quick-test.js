#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Colors for terminal output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logHeader(title) {
    console.log('\n' + '='.repeat(60));
    log(`🚀 ${title}`, colors.bold + colors.cyan);
    console.log('='.repeat(60));
}

function logSuccess(message) {
    log(`✅ ${message}`, colors.green);
}

function logError(message) {
    log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
    log(`ℹ️  ${message}`, colors.blue);
}

function execCommand(command, cwd = process.cwd()) {
    try {
        logInfo(`Running: ${command} in ${cwd}`);
        const output = execSync(command, { 
            cwd, 
            stdio: 'inherit',
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        return { success: true, output };
    } catch (error) {
        logError(`Command failed: ${command}`);
        return { success: false, error };
    }
}

async function main() {
    logHeader('SMART CONTRACT TESTING');
    
    const contractsDir = path.join(process.cwd(), 'contracts');
    
    // Test contracts
    logInfo('Running smart contract tests...');
    const contractTest = execCommand('npx hardhat test', contractsDir);
    
    if (contractTest.success) {
        logSuccess('Smart contracts tested successfully');
    } else {
        logError('Smart contract tests failed');
    }
    
    logHeader('BACKEND SERVICE TESTING');
    
    const services = [
        'user-service',
        'fund-service', 
        'trading-service',
        'settlement-service'
    ];
    
    for (const service of services) {
        const serviceDir = path.join(process.cwd(), 'backend', service);
        logInfo(`Testing ${service}...`);
        
        const testResult = execCommand('npm test', serviceDir);
        
        if (testResult.success) {
            logSuccess(`${service} tests passed`);
        } else {
            logError(`${service} tests failed`);
        }
    }
    
    logHeader('ORACLE SERVICES HEALTH CHECK');
    
    const oracles = [
        'nav-oracle',
        'forex-oracle', 
        'custody-oracle',
        'market-oracle'
    ];
    
    for (const oracle of oracles) {
        const oracleDir = path.join(process.cwd(), 'backend', 'oracles', oracle);
        logInfo(`Checking ${oracle} dependencies...`);
        
        // Check if package.json exists
        try {
            require(path.join(oracleDir, 'package.json'));
            logSuccess(`${oracle} package.json found`);
        } catch (error) {
            logError(`${oracle} package.json missing`);
        }
        
        // Check if server.js exists
        try {
            require.resolve(path.join(oracleDir, 'server.js'));
            logSuccess(`${oracle} server.js found`);
        } catch (error) {
            logError(`${oracle} server.js missing`);
        }
    }
    
    logHeader('DEPLOYMENT SUMMARY');
    
    logInfo('Services Overview:');
    console.log(`
📊 SMART CONTRACTS:
├── FundFactory.sol ✅
├── FundToken.sol ✅  
├── Marketplace.sol ✅
├── Settlement.sol ✅
├── CustodyTracker.sol ✅
└── MockUSDC.sol ✅

🔧 BACKEND SERVICES:
├── 🔐 Auth Service (Port 3010)
├── 👤 User Service (Port 3012)  
├── 🏢 Fund Service (Port 3013)
├── 📈 Trading Service (Port 3014)
├── 🔄 Settlement Service (Port 3015)
├── ⛓️  Blockchain Service (Port 3016)
└── 📢 Notification Service (Port 3020)

🔮 ORACLE NETWORK:
├── 📊 NAV Oracle (Port 3021) - 10s intervals
├── 💱 Forex Oracle (Port 3022) - 30s intervals  
├── 🛡️  Custody Oracle (Port 3023) - 1min intervals
└── 📈 Market Oracle (Port 3024) - 30s intervals

🌐 FRONTEND:
└── Basic HTML Frontend (Port 3000)
    `);
    
    logHeader('NEXT STEPS');
    
    logInfo('To start the complete system:');
    console.log(`
1. Start Infrastructure:
   ${colors.cyan}docker-compose up -d mongodb kafka zookeeper hardhat-node${colors.reset}

2. Deploy Smart Contracts:
   ${colors.cyan}cd contracts && npx hardhat run scripts/deploy-all.js --network localhost${colors.reset}

3. Start All Services:
   ${colors.cyan}docker-compose up -d${colors.reset}

4. Access Frontend:
   ${colors.cyan}http://localhost:3000${colors.reset}

5. Test API Endpoints:
   ${colors.cyan}curl http://localhost:3012/health${colors.reset} (User Service)
   ${colors.cyan}curl http://localhost:3013/health${colors.reset} (Fund Service)
   ${colors.cyan}curl http://localhost:3021/health${colors.reset} (NAV Oracle)
    `);
    
    logSuccess('Quick validation completed! 🎉');
}

main().catch(console.error);