const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Settlement", function () {
  let settlement;
  let mockUSDC;
  let fundToken;
  let fundFactory;
  let owner;
  let buyer;
  let seller;
  let resolver;
  let feeRecipient;
  let user1;
  let user2;

  // Test constants
  const SETTLEMENT_FEE_RATE = 25; // 0.25%
  const DEFAULT_ESCROW_PERIOD = 24 * 60 * 60; // 24 hours
  const DISPUTE_PERIOD = 7 * 24 * 60 * 60; // 7 days
  const MAX_BATCH_SIZE = 50;

  // Sample data
  const sampleFundInfo = {
    fundName: "Test Settlement Fund",
    fundType: "equity",
    description: "Test fund for settlement",
    manager: "",
    minimumInvestment: ethers.parseUnits("1000", 6),
    currentNAV: ethers.parseUnits("100", 6),
    totalAssetValue: ethers.parseUnits("1000000", 6),
    isActive: true,
    createdAt: 0
  };

  const sampleSuitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate",
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "US"],
    isActive: true
  };

  beforeEach(async function () {
    [owner, buyer, seller, resolver, feeRecipient, user1, user2] = await ethers.getSigners();
    
    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy Settlement
    const Settlement = await ethers.getContractFactory("Settlement");
    settlement = await Settlement.deploy(feeRecipient.address);
    await settlement.waitForDeployment();

    // Deploy FundFactory and create a fund token
    const FundFactory = await ethers.getContractFactory("FundFactory");
    fundFactory = await FundFactory.deploy(owner.address);
    await fundFactory.waitForDeployment();

    await fundFactory.connect(owner).registerFundHouse(user1.address);
    
    const fundInfo = { ...sampleFundInfo, manager: user2.address };
    const tx = await fundFactory.connect(user1).createFund(fundInfo, sampleSuitabilityCriteria);
    const receipt = await tx.wait();
    
    const fundCreatedEvent = receipt.logs.find(log => 
      log.fragment && log.fragment.name === "FundCreated"
    );
    const fundTokenAddress = fundCreatedEvent.args[0];
    fundToken = await ethers.getContractAt("FundToken", fundTokenAddress);

    // Setup USDC balances
    const usdcAmount = ethers.parseUnits("1000000", 6); // 1M USDC
    await mockUSDC.mint(buyer.address, usdcAmount, "Test setup");
    await mockUSDC.mint(seller.address, usdcAmount, "Test setup");
    await mockUSDC.mint(user1.address, usdcAmount, "Test setup");

    // Approve Settlement contract
    await mockUSDC.connect(buyer).approve(await settlement.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(seller).approve(await settlement.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(user1).approve(await settlement.getAddress(), ethers.MaxUint256);

    // Setup fund tokens - set marketplace and mint tokens
    await fundToken.connect(user2).setMarketplace(owner.address);
    await fundToken.connect(owner).mint(seller.address, ethers.parseUnits("10000", 6));
    await fundToken.connect(seller).approve(await settlement.getAddress(), ethers.MaxUint256);

    // Add resolver
    await settlement.connect(owner).setAuthorizedResolver(resolver.address, true);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await settlement.owner()).to.equal(owner.address);
    });

    it("Should set the correct fee recipient", async function () {
      expect(await settlement.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should initialize with correct default values", async function () {
      expect(await settlement.defaultEscrowPeriod()).to.equal(DEFAULT_ESCROW_PERIOD);
      expect(await settlement.disputePeriod()).to.equal(DISPUTE_PERIOD);
      expect(await settlement.settlementFeeRate()).to.equal(SETTLEMENT_FEE_RATE);
      expect(await settlement.maxBatchSize()).to.equal(MAX_BATCH_SIZE);
      expect(await settlement.nextSettlementId()).to.equal(1);
      expect(await settlement.nextEscrowId()).to.equal(1);
      expect(await settlement.nextBatchId()).to.equal(1);
    });

    it("Should set owner as authorized resolver", async function () {
      expect(await settlement.authorizedResolvers(owner.address)).to.be.true;
    });
  });

  describe("Settlement Creation", function () {
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6); // $10,000

    it("Should create settlement successfully", async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400; // Tomorrow

      await expect(
        settlement.createSettlement(
          buyer.address,
          seller.address,
          await fundToken.getAddress(),
          await mockUSDC.getAddress(),
          tokenAmount,
          paymentAmount,
          settlementDate
        )
      ).to.emit(settlement, "SettlementCreated")
        .withArgs(
          1, // settlementId
          buyer.address,
          seller.address,
          await fundToken.getAddress(),
          tokenAmount,
          paymentAmount
        );

      const settlementRecord = await settlement.getSettlement(1);
      expect(settlementRecord.buyer).to.equal(buyer.address);
      expect(settlementRecord.seller).to.equal(seller.address);
      expect(settlementRecord.tokenAmount).to.equal(tokenAmount);
      expect(settlementRecord.paymentAmount).to.equal(paymentAmount);
      expect(settlementRecord.status).to.equal(0); // Pending
      expect(settlementRecord.settlementFee).to.equal(paymentAmount * BigInt(SETTLEMENT_FEE_RATE) / 10000n);
    });

    it("Should track user settlements", async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;

      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );

      const buyerSettlements = await settlement.getUserSettlements(buyer.address);
      const sellerSettlements = await settlement.getUserSettlements(seller.address);

      expect(buyerSettlements.length).to.equal(1);
      expect(sellerSettlements.length).to.equal(1);
      expect(buyerSettlements[0]).to.equal(1);
      expect(sellerSettlements[0]).to.equal(1);
    });

    it("Should revert with invalid parameters", async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;

      // Invalid buyer address
      await expect(
        settlement.createSettlement(
          ethers.ZeroAddress,
          seller.address,
          await fundToken.getAddress(),
          await mockUSDC.getAddress(),
          tokenAmount,
          paymentAmount,
          settlementDate
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");

      // Zero token amount
      await expect(
        settlement.createSettlement(
          buyer.address,
          seller.address,
          await fundToken.getAddress(),
          await mockUSDC.getAddress(),
          0,
          paymentAmount,
          settlementDate
        )
      ).to.be.revertedWithCustomError(settlement, "ZeroAmount");
    });

    it("Should increment settlement ID correctly", async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;

      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );

      expect(await settlement.nextSettlementId()).to.equal(2);

      await settlement.createSettlement(
        buyer.address,
        user1.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );

      expect(await settlement.nextSettlementId()).to.equal(3);
    });
  });

  describe("Escrow Management", function () {
    let settlementId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      const tx = await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;
    });

    it("Should deposit escrow successfully", async function () {
      const escrowAmount = ethers.parseUnits("5000", 6); // $5,000

      await expect(
        settlement.connect(buyer).depositEscrow(
          settlementId,
          await mockUSDC.getAddress(),
          escrowAmount,
          "Payment escrow"
        )
      ).to.emit(settlement, "EscrowDeposited")
        .withArgs(1, settlementId, buyer.address, await mockUSDC.getAddress(), escrowAmount);

      const escrowRecord = await settlement.getEscrow(1);
      expect(escrowRecord.depositor).to.equal(buyer.address);
      expect(escrowRecord.amount).to.equal(escrowAmount);
      expect(escrowRecord.purpose).to.equal("Payment escrow");
      expect(escrowRecord.released).to.be.false;

      // Check settlement status updated
      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(1); // InEscrow

      // Check escrow balance
      const balance = await settlement.getEscrowBalance(buyer.address, await mockUSDC.getAddress());
      expect(balance).to.equal(escrowAmount);
    });

    it("Should handle multiple escrow deposits", async function () {
      const escrowAmount1 = ethers.parseUnits("5000", 6);
      const escrowAmount2 = ethers.parseUnits("3000", 6);

      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        escrowAmount1,
        "Payment escrow"
      );

      await settlement.connect(seller).depositEscrow(
        settlementId,
        await fundToken.getAddress(),
        tokenAmount,
        "Token escrow"
      );

      const buyerBalance = await settlement.getEscrowBalance(buyer.address, await mockUSDC.getAddress());
      const sellerBalance = await settlement.getEscrowBalance(seller.address, await fundToken.getAddress());

      expect(buyerBalance).to.equal(escrowAmount1);
      expect(sellerBalance).to.equal(tokenAmount);
    });

    it("Should revert escrow deposit with invalid parameters", async function () {
      // Invalid settlement ID
      await expect(
        settlement.connect(buyer).depositEscrow(
          999,
          await mockUSDC.getAddress(),
          ethers.parseUnits("1000", 6),
          "Test"
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");

      // Zero amount
      await expect(
        settlement.connect(buyer).depositEscrow(
          settlementId,
          await mockUSDC.getAddress(),
          0,
          "Test"
        )
      ).to.be.revertedWithCustomError(settlement, "ZeroAmount");
    });
  });

  describe("Settlement Confirmation", function () {
    let settlementId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;

      // Add escrow
      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );
    });

    it("Should allow buyer to confirm settlement", async function () {
      await expect(
        settlement.connect(buyer).confirmSettlement(settlementId)
      ).to.emit(settlement, "SettlementConfirmed")
        .withArgs(settlementId, buyer.address, true, false);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.buyerConfirmed).to.be.true;
      expect(settlementRecord.sellerConfirmed).to.be.false;
    });

    it("Should allow seller to confirm settlement", async function () {
      await expect(
        settlement.connect(seller).confirmSettlement(settlementId)
      ).to.emit(settlement, "SettlementConfirmed")
        .withArgs(settlementId, seller.address, false, true);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.buyerConfirmed).to.be.false;
      expect(settlementRecord.sellerConfirmed).to.be.true;
    });    it("Should auto-complete settlement when both parties confirm", async function () {
      await settlement.connect(buyer).confirmSettlement(settlementId);
      
      const tx = await settlement.connect(seller).confirmSettlement(settlementId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      
      await expect(tx)
        .to.emit(settlement, "SettlementCompleted")
        .withArgs(settlementId, block.timestamp);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(4); // Completed
    });

    it("Should revert confirmation from unauthorized user", async function () {
      await expect(
        settlement.connect(user1).confirmSettlement(settlementId)
      ).to.be.revertedWithCustomError(settlement, "UnauthorizedAccess");
    });

    it("Should revert confirmation for invalid settlement", async function () {
      await expect(
        settlement.connect(buyer).confirmSettlement(999)
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");
    });
  });

  describe("Dispute Management", function () {
    let settlementId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;

      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );
    });

    it("Should allow buyer to raise dispute", async function () {
      const reason = "Seller did not deliver tokens";

      await expect(
        settlement.connect(buyer).raiseDispute(settlementId, reason)
      ).to.emit(settlement, "DisputeRaised")
        .withArgs(settlementId, buyer.address, reason);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.disputeStatus).to.equal(1); // Raised
      expect(settlementRecord.disputeReason).to.equal(reason);
      expect(settlementRecord.status).to.equal(2); // Disputed
    });

    it("Should allow seller to raise dispute", async function () {
      const reason = "Buyer payment failed";

      await expect(
        settlement.connect(seller).raiseDispute(settlementId, reason)
      ).to.emit(settlement, "DisputeRaised")
        .withArgs(settlementId, seller.address, reason);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.disputeStatus).to.equal(1); // Raised
      expect(settlementRecord.disputeReason).to.equal(reason);
    });    it("Should allow authorized resolver to resolve dispute", async function () {
      await settlement.connect(buyer).raiseDispute(settlementId, "Test dispute");

      await expect(
        settlement.connect(resolver).resolveDispute(settlementId, true)
      ).to.emit(settlement, "DisputeResolved")
        .withArgs(settlementId, resolver.address, true);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.disputeStatus).to.equal(3); // Resolved
      expect(settlementRecord.disputeResolver).to.equal(resolver.address);
      expect(settlementRecord.status).to.equal(4); // Completed (auto-completed after resolution)
    });it("Should auto-complete settlement after dispute resolution", async function () {
      await settlement.connect(buyer).raiseDispute(settlementId, "Test dispute");

      const tx = await settlement.connect(resolver).resolveDispute(settlementId, false);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      
      await expect(tx)
        .to.emit(settlement, "SettlementCompleted")
        .withArgs(settlementId, block.timestamp);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(4); // Completed
    });

    it("Should revert dispute from unauthorized user", async function () {
      await expect(
        settlement.connect(user1).raiseDispute(settlementId, "Unauthorized dispute")
      ).to.be.revertedWithCustomError(settlement, "UnauthorizedAccess");
    });

    it("Should revert dispute resolution from unauthorized resolver", async function () {
      await settlement.connect(buyer).raiseDispute(settlementId, "Test dispute");

      await expect(
        settlement.connect(user1).resolveDispute(settlementId, true)
      ).to.be.revertedWithCustomError(settlement, "UnauthorizedAccess");
    });
  });

  describe("Escrow Release", function () {
    let settlementId;
    let escrowId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;

      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );
      
      escrowId = 1;

      // Complete settlement
      await settlement.connect(buyer).confirmSettlement(settlementId);
      await settlement.connect(seller).confirmSettlement(settlementId);
    });

    it("Should release escrow after maturity and completion", async function () {
      // Fast forward time past escrow period
      await ethers.provider.send("evm_increaseTime", [DEFAULT_ESCROW_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await mockUSDC.balanceOf(buyer.address);

      await expect(
        settlement.releaseEscrow(escrowId)
      ).to.emit(settlement, "EscrowReleased")
        .withArgs(escrowId, buyer.address, paymentAmount);

      const finalBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBalance - initialBalance).to.equal(paymentAmount);

      const escrowRecord = await settlement.getEscrow(escrowId);
      expect(escrowRecord.released).to.be.true;
    });

    it("Should revert escrow release before maturity", async function () {
      await expect(
        settlement.releaseEscrow(escrowId)
      ).to.be.revertedWithCustomError(settlement, "EscrowNotMatured");
    });

    it("Should revert escrow release for uncompleted settlement", async function () {
      // Create new settlement that's not completed
      const newSettlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        user1.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        newSettlementDate
      );

      await settlement.connect(buyer).depositEscrow(
        2,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [DEFAULT_ESCROW_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      await expect(
        settlement.releaseEscrow(2)
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");
    });

    it("Should revert double escrow release", async function () {
      // Fast forward time past escrow period
      await ethers.provider.send("evm_increaseTime", [DEFAULT_ESCROW_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      await settlement.releaseEscrow(escrowId);

      await expect(
        settlement.releaseEscrow(escrowId)
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");
    });
  });

  describe("Batch Settlement", function () {
    let settlementIds;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      settlementIds = [];
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;

      // Create multiple settlements
      for (let i = 0; i < 3; i++) {
        await settlement.createSettlement(
          buyer.address,
          seller.address,
          await fundToken.getAddress(),
          await mockUSDC.getAddress(),
          tokenAmount,
          paymentAmount,
          settlementDate
        );
        
        settlementIds.push(i + 1);

        // Add escrow to put settlement in InEscrow status
        await settlement.connect(buyer).depositEscrow(
          i + 1,
          await mockUSDC.getAddress(),
          paymentAmount,
          "Payment escrow"
        );
      }
    });

    it("Should create batch settlement successfully", async function () {
      await expect(
        settlement.createBatchSettlement(settlementIds)
      ).to.emit(settlement, "BatchSettlementCreated")
        .withArgs(1, settlementIds.length, owner.address);

      const batchRecord = await settlement.getBatchSettlement(1);
      expect(batchRecord.settlementIds.length).to.equal(3);
      expect(batchRecord.totalTokens).to.equal(tokenAmount * 3n);
      expect(batchRecord.totalPayment).to.equal(paymentAmount * 3n);
      expect(batchRecord.executed).to.be.false;
    });

    it("Should execute batch settlement after delay", async function () {
      await settlement.createBatchSettlement(settlementIds);      // Fast forward time past execution delay (1 hour)
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      const tx = await settlement.executeBatchSettlement(1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      
      await expect(tx)
        .to.emit(settlement, "BatchSettlementExecuted")
        .withArgs(1, block.timestamp);

      const batchRecord = await settlement.getBatchSettlement(1);
      expect(batchRecord.executed).to.be.true;

      // Check all settlements are completed
      for (let i = 0; i < settlementIds.length; i++) {
        const settlementRecord = await settlement.getSettlement(settlementIds[i]);
        expect(settlementRecord.status).to.equal(4); // Completed
      }
    });

    it("Should revert batch execution before delay", async function () {
      await settlement.createBatchSettlement(settlementIds);

      await expect(
        settlement.executeBatchSettlement(1)
      ).to.be.revertedWithCustomError(settlement, "EscrowNotMatured");
    });

    it("Should revert empty batch settlement", async function () {
      await expect(
        settlement.createBatchSettlement([])
      ).to.be.revertedWithCustomError(settlement, "InvalidBatchSize");
    });

    it("Should revert batch settlement with too many settlements", async function () {
      const largeArray = Array.from({length: MAX_BATCH_SIZE + 1}, (_, i) => i + 1);
      
      await expect(
        settlement.createBatchSettlement(largeArray)
      ).to.be.revertedWithCustomError(settlement, "InvalidBatchSize");
    });

    it("Should revert double batch execution", async function () {
      await settlement.createBatchSettlement(settlementIds);

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await settlement.executeBatchSettlement(1);

      await expect(
        settlement.executeBatchSettlement(1)
      ).to.be.revertedWithCustomError(settlement, "BatchAlreadyExecuted");
    });
  });

  describe("Settlement Cancellation", function () {
    let settlementId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;
    });

    it("Should allow buyer to cancel settlement", async function () {
      const reason = "Changed mind";

      await expect(
        settlement.connect(buyer).cancelSettlement(settlementId, reason)
      ).to.emit(settlement, "SettlementCancelled")
        .withArgs(settlementId, reason);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(5); // Cancelled
    });

    it("Should allow seller to cancel settlement", async function () {
      const reason = "Tokens not available";

      await expect(
        settlement.connect(seller).cancelSettlement(settlementId, reason)
      ).to.emit(settlement, "SettlementCancelled")
        .withArgs(settlementId, reason);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(5); // Cancelled
    });

    it("Should allow owner to cancel settlement", async function () {
      const reason = "Admin cancellation";

      await expect(
        settlement.connect(owner).cancelSettlement(settlementId, reason)
      ).to.emit(settlement, "SettlementCancelled")
        .withArgs(settlementId, reason);

      const settlementRecord = await settlement.getSettlement(settlementId);
      expect(settlementRecord.status).to.equal(5); // Cancelled
    });

    it("Should revert cancellation from unauthorized user", async function () {
      await expect(
        settlement.connect(user1).cancelSettlement(settlementId, "Unauthorized")
      ).to.be.revertedWithCustomError(settlement, "UnauthorizedAccess");
    });

    it("Should revert cancellation of completed settlement", async function () {
      // Complete settlement first
      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );
      await settlement.connect(buyer).confirmSettlement(settlementId);
      await settlement.connect(seller).confirmSettlement(settlementId);

      await expect(
        settlement.connect(buyer).cancelSettlement(settlementId, "Cannot cancel")
      ).to.be.revertedWithCustomError(settlement, "InvalidSettlement");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set settlement configuration", async function () {
      const newEscrowPeriod = 48 * 60 * 60; // 48 hours
      const newDisputePeriod = 14 * 24 * 60 * 60; // 14 days
      const newFeeRate = 50; // 0.5%
      const newMaxBatchSize = 100;

      await settlement.connect(owner).setSettlementConfig(
        newEscrowPeriod,
        newDisputePeriod,
        newFeeRate,
        newMaxBatchSize
      );

      expect(await settlement.defaultEscrowPeriod()).to.equal(newEscrowPeriod);
      expect(await settlement.disputePeriod()).to.equal(newDisputePeriod);
      expect(await settlement.settlementFeeRate()).to.equal(newFeeRate);
      expect(await settlement.maxBatchSize()).to.equal(newMaxBatchSize);
    });

    it("Should revert setting fee rate above maximum", async function () {
      await expect(
        settlement.connect(owner).setSettlementConfig(
          DEFAULT_ESCROW_PERIOD,
          DISPUTE_PERIOD,
          1001, // 10.01% - above 10% limit
          MAX_BATCH_SIZE
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidFeeRate");
    });

    it("Should allow owner to set fee recipient", async function () {
      await settlement.connect(owner).setFeeRecipient(user1.address);
      expect(await settlement.feeRecipient()).to.equal(user1.address);
    });

    it("Should allow owner to manage authorized resolvers", async function () {
      await settlement.connect(owner).setAuthorizedResolver(user1.address, true);
      expect(await settlement.authorizedResolvers(user1.address)).to.be.true;

      await settlement.connect(owner).setAuthorizedResolver(user1.address, false);
      expect(await settlement.authorizedResolvers(user1.address)).to.be.false;
    });

    it("Should revert admin functions from non-owner", async function () {
      await expect(
        settlement.connect(user1).setFeeRecipient(user2.address)
      ).to.be.revertedWithCustomError(settlement, "OwnableUnauthorizedAccount");

      await expect(
        settlement.connect(user1).setAuthorizedResolver(user2.address, true)
      ).to.be.revertedWithCustomError(settlement, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause and unpause", async function () {
      await settlement.connect(owner).pause();
      expect(await settlement.paused()).to.be.true;

      await settlement.connect(owner).unpause();
      expect(await settlement.paused()).to.be.false;
    });

    it("Should prevent operations when paused", async function () {
      await settlement.connect(owner).pause();

      await expect(
        settlement.createSettlement(
          buyer.address,
          seller.address,
          await fundToken.getAddress(),
          await mockUSDC.getAddress(),
          ethers.parseUnits("100", 6),
          ethers.parseUnits("10000", 6),
          Math.floor(Date.now() / 1000) + 86400
        )
      ).to.be.revertedWithCustomError(settlement, "EnforcedPause");
    });

    it("Should allow emergency withdrawal when paused", async function () {
      // First create settlement and deposit escrow
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        ethers.parseUnits("100", 6),
        ethers.parseUnits("10000", 6),
        settlementDate
      );

      await settlement.connect(buyer).depositEscrow(
        1,
        await mockUSDC.getAddress(),
        ethers.parseUnits("5000", 6),
        "Test escrow"
      );

      // Pause and perform emergency withdrawal
      await settlement.connect(owner).pause();

      const initialBalance = await mockUSDC.balanceOf(owner.address);
      const withdrawAmount = ethers.parseUnits("1000", 6);

      await settlement.connect(owner).emergencyWithdraw(
        await mockUSDC.getAddress(),
        withdrawAmount,
        owner.address
      );

      const finalBalance = await mockUSDC.balanceOf(owner.address);
      expect(finalBalance - initialBalance).to.equal(withdrawAmount);
    });

    it("Should revert emergency withdrawal when not paused", async function () {
      await expect(
        settlement.connect(owner).emergencyWithdraw(
          await mockUSDC.getAddress(),
          ethers.parseUnits("1000", 6),
          owner.address
        )
      ).to.be.revertedWithCustomError(settlement, "ExpectedPause");
    });
  });

  describe("View Functions", function () {
    let settlementId;
    const tokenAmount = ethers.parseUnits("100", 6);
    const paymentAmount = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
      const settlementDate = Math.floor(Date.now() / 1000) + 86400;
      await settlement.createSettlement(
        buyer.address,
        seller.address,
        await fundToken.getAddress(),
        await mockUSDC.getAddress(),
        tokenAmount,
        paymentAmount,
        settlementDate
      );
      
      settlementId = 1;

      await settlement.connect(buyer).depositEscrow(
        settlementId,
        await mockUSDC.getAddress(),
        paymentAmount,
        "Payment escrow"
      );
    });

    it("Should return correct settlement details", async function () {
      const settlementRecord = await settlement.getSettlement(settlementId);
      
      expect(settlementRecord.settlementId).to.equal(settlementId);
      expect(settlementRecord.buyer).to.equal(buyer.address);
      expect(settlementRecord.seller).to.equal(seller.address);
      expect(settlementRecord.fundToken).to.equal(await fundToken.getAddress());
      expect(settlementRecord.paymentToken).to.equal(await mockUSDC.getAddress());
      expect(settlementRecord.tokenAmount).to.equal(tokenAmount);
      expect(settlementRecord.paymentAmount).to.equal(paymentAmount);
      expect(settlementRecord.status).to.equal(1); // InEscrow
    });

    it("Should return correct user settlements", async function () {
      const buyerSettlements = await settlement.getUserSettlements(buyer.address);
      const sellerSettlements = await settlement.getUserSettlements(seller.address);
      
      expect(buyerSettlements.length).to.equal(1);
      expect(sellerSettlements.length).to.equal(1);
      expect(buyerSettlements[0]).to.equal(settlementId);
      expect(sellerSettlements[0]).to.equal(settlementId);
    });

    it("Should return correct escrow details", async function () {
      const escrowRecord = await settlement.getEscrow(1);
      
      expect(escrowRecord.escrowId).to.equal(1);
      expect(escrowRecord.settlementId).to.equal(settlementId);
      expect(escrowRecord.depositor).to.equal(buyer.address);
      expect(escrowRecord.token).to.equal(await mockUSDC.getAddress());
      expect(escrowRecord.amount).to.equal(paymentAmount);
      expect(escrowRecord.purpose).to.equal("Payment escrow");
    });

    it("Should return correct escrow balance", async function () {
      const balance = await settlement.getEscrowBalance(buyer.address, await mockUSDC.getAddress());
      expect(balance).to.equal(paymentAmount);
      
      const zeroBalance = await settlement.getEscrowBalance(seller.address, await mockUSDC.getAddress());
      expect(zeroBalance).to.equal(0);
    });
  });
});
