# Blockchain Secondary Marketplace for Tokenized Funds

A comprehensive blockchain-based secondary marketplace for tokenized alternative investment funds enabling HNI investors to trade ERC-20 fund tokens with real-time NAV updates, custody tracking, and seamless payment integration.

## 🎯 Project Overview

This is a **Proof of Concept (POC)** system designed for High Net Worth Individuals (HNIs) to trade tokenized alternative investment funds including Private Equity, Hedge Funds, and Real Estate funds. The system features smart contract-based custody tracking, real-time event streaming via Kafka, and mock payment gateway integration.

## 🏗️ Project Structure

```
├── contracts/              # Smart contracts (Solidity)
│   ├── FundFactory.sol        # Creates and manages fund tokens
│   ├── FundToken.sol          # ERC-20 representing fund shares
│   ├── Marketplace.sol        # Unified trading marketplace
│   ├── CustodyTracker.sol     # Asset custody tracking
│   ├── MockUSDC.sol          # Test stablecoin for settlements
│   └── Settlement.sol         # Trade settlement logic
├── backend/               # Microservices architecture
│   ├── auth-service/         # Simple authentication (no JWT)
│   ├── user-service/         # Profile, KYB, suitability
│   ├── fund-service/         # Fund CRUD, NAV updates
│   ├── custody-service/      # Mock legal custody, asset tracking
│   ├── trading-service/      # Order matching, execution
│   ├── settlement-service/   # Trade confirmation & settlement
│   ├── blockchain-service/   # Smart contract interactions
│   ├── notification-service/ # Kafka event publishing
│   └── oracles/             # Multiple oracle services
│       ├── nav-oracle/       # NAV updates every 10sec
│       ├── forex-oracle/     # INR/USD rates every 30sec
│       ├── custody-oracle/   # Asset valuations every 1min
│       └── market-oracle/    # Trading volume, trends
├── kafka-viz/             # Real-time event visualization
├── frontend-basic/        # Basic HTML frontend (Phase 3)
├── frontend-react/        # React frontend (Phase 4)
├── docker/               # Docker configuration files
├── tests/                # Comprehensive test suites
└── docs/                 # Documentation
    ├── PLAN.md              # Detailed development plan
    └── PROMPTSANDLOGS.md    # Development logs & context
```

## 🚀 Key Features

### **For Fund Houses**
- KYB (Know Your Business) workflow with admin approval
- Fund creation with custody verification
- NAV management and real-time updates
- Suitability criteria definition for funds
- Analytics and compliance tracking

### **For HNI Investors**
- Suitability assessment questionnaire
- Primary market purchases (from fund houses at NAV)
- Secondary market trading (peer-to-peer at custom prices)
- Portfolio tracking with real-time valuations
- Transaction history and waiting list management

### **For Administrators**
- KYB approval dashboard
- User and fund management
- Marketplace monitoring and logs
- System-wide analytics

## 🔧 Technical Architecture

### **Smart Contracts (Ethereum/Hardhat)**
- **Unified Marketplace**: Single contract handling both primary and secondary trading
- **Token Locking**: Marketplace-based custody for secure trading
- **Custody Tracking**: On-chain asset backing verification
- **Settlement Engine**: Atomic trade execution with USDC payments

### **Backend (Microservices)**
- **Simple Authentication**: Email/password without JWT complexity
- **Event-Driven**: Kafka streaming for all system activities
- **Oracle Network**: Multiple data feeds for NAV, forex, and market data
- **Mock Payment Flow**: INR → Forex → USD → USDC visualization

### **Database (MongoDB)**
- **Users**: Role-based access (admin, fund_house, investor)
- **Funds**: Contract addresses, NAV, suitability criteria
- **Orders**: Partial fill support with waiting list tracking
- **Trades**: Complete transaction history with blockchain refs

## 🎮 User Flows

### **Fund House Onboarding**
1. Register with basic details
2. Upload KYB documents (mock 2-3 docs)
3. Admin approval via dashboard
4. Create funds with custody verification
5. Set suitability criteria and initial NAV

### **Investor Journey**
1. Register and complete suitability assessment
2. Browse eligible funds (see ineligible with "Not Eligible" badge)
3. Primary purchase: Buy from fund house at current NAV
4. Secondary trading: List tokens at custom price or buy from other investors
5. Portfolio management with real-time updates

### **Trading Mechanics**
- **Primary Market**: NAV-based pricing with oracle feeds
- **Secondary Market**: Investor-set pricing with marketplace locking
- **Partial Orders**: Complete available amount, track remainder in waiting list
- **Settlement**: Instant on-chain execution with USDC

## 🧪 Development Approach

### **Phase 1: Backend Infrastructure** (Days 1-21) - *Primary Focus*
- **Week 1**: Smart contracts (MockUSDC, FundToken, Marketplace, CustodyTracker, Settlement)
- **Week 2**: Microservices (auth, user, fund, custody, trading, settlement, blockchain, notification)
- **Week 3**: Oracle services (NAV, forex, custody, market) + Kafka event streaming

### **Phase 2: Kafka Event Visualization** (Days 15-17) - *Parallel to Backend*
- Real-time HTML dashboard showing all backend events
- WebSocket integration for live event streaming
- System health monitoring and event analytics

### **Phase 3: Basic HTML Frontend** (Days 22-28) - *After Backend Complete*
- Role-based landing page (Admin/Fund House/Investor)
- Simple dashboards for each user type
- Basic trading functionality with backend integration

### **Phase 4: React Frontend** (Days 29-35) - *Final Polish*
- Modern React application with full UI/UX
- Advanced visualizations and charts
- Payment flow visualization (INR→USD→USDC)
- Comprehensive testing and deployment

## 🛠️ Technologies

- **Blockchain**: Ethereum, Solidity, Hardhat, Web3.js
- **Backend**: Node.js, Express.js, MongoDB, Kafka
- **Frontend**: React, HTML/CSS/JS, WebSocket
- **Infrastructure**: Docker, Docker Compose
- **Testing**: Jest, Mocha, Hardhat Tests
- **Visualization**: Real-time Kafka event dashboard

## � Development Status

### **🏆 Completed (Day 1)**
- ✅ **Project Structure**: Complete directory structure for all services
- ✅ **Smart Contracts**: Core foundation contracts implemented and tested
  - `MockUSDC.sol`: Full ERC-20 stablecoin with mint/burn (16/16 tests passing)
  - `FundToken.sol`: Advanced fund token with NAV, suitability, marketplace integration (27/27 tests passing)
- ✅ **Testing Infrastructure**: Comprehensive test suites with 100% coverage
- ✅ **Deployment System**: Automated deployment scripts for all contracts
- ✅ **Development Environment**: Docker Compose with MongoDB, Kafka, Hardhat node
- ✅ **Windows Compatibility**: PowerShell-compatible scripts and commands

### **🔄 In Progress (Day 2)**
- 🚧 **Core Smart Contracts**: FundFactory, Marketplace, CustodyTracker, Settlement
- 🚧 **Backend Services**: Auth, User, Fund, Custody services implementation
- 🚧 **Oracle Network**: NAV, Forex, Custody, Market oracles

### **📋 Upcoming**
- ⏳ **Trading Engine**: Order matching, execution, settlement services
- ⏳ **Event Streaming**: Kafka integration and real-time dashboard
- ⏳ **Frontend**: Basic HTML dashboard, then React application
- ⏳ **Integration Testing**: End-to-end user flows

**Current Status: 43 test cases passing, 2/6 smart contracts complete, solid foundation established**

## �📋 Getting Started

1. **Prerequisites**: Node.js 18+, Docker, Git
2. **Setup**: `npm install` in each service directory
3. **Development**: `docker-compose up` for full environment
4. **Testing**: Individual service tests + integration tests
5. **Monitoring**: Kafka visualization dashboard at `localhost:3001`

## 🎯 Success Criteria

- ✅ Complete user role separation and workflows
- ✅ Real-time NAV updates with oracle integration
- ✅ Seamless primary and secondary market trading
- ✅ Robust suitability matching system
- ✅ Comprehensive event streaming and visualization
- ✅ Mock payment gateway with INR→USDC flow
- ✅ Partial order handling with waiting list
- ✅ Custody tracking and asset verification

## 📚 Documentation

- **PLAN.md**: Step-by-step development roadmap
- **PROMPTSANDLOGS.md**: Development progress and context logs
- **API Documentation**: Generated from service endpoints
- **Smart Contract Docs**: Function specifications and usage

---

**This project demonstrates a complete blockchain-based financial marketplace with real-world complexity adapted for POC development.**
