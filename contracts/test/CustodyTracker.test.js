const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CustodyTracker", function () {
  let custodyTracker;
  let fundFactory;
  let fundToken;
  let mockUSDC;
  let owner;
  let oracle;
  let custodian;
  let fundHouse;
  let fundManager;
  let user1;

  // Test constants
  const BASIS_POINTS = 10000;
  const MIN_VALUATION = ethers.parseUnits("1", 6); // $1 minimum
  
  // Test data
  const sampleAsset = {
    assetId: "ASSET001",
    assetType: "real_estate",
    description: "Prime commercial real estate in Mumbai",
    valuationUSD: ethers.parseUnits("1000000", 6), // $1M
    custodian: "ABC Custody Services",
    location: "Mumbai, India"
  };

  const sampleFundInfo = {
    fundName: "Test Real Estate Fund",
    fundType: "real_estate",
    description: "Test fund for custody tracking",
    manager: "",
    minimumInvestment: ethers.parseUnits("10000", 6),
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
    [owner, oracle, custodian, fundHouse, fundManager, user1] = await ethers.getSigners();
    
    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy CustodyTracker
    const CustodyTracker = await ethers.getContractFactory("CustodyTracker");
    custodyTracker = await CustodyTracker.deploy(owner.address);
    await custodyTracker.waitForDeployment();

    // Deploy FundFactory and create a fund token for testing
    const FundFactory = await ethers.getContractFactory("FundFactory");
    fundFactory = await FundFactory.deploy(owner.address);
    await fundFactory.waitForDeployment();

    // Register fund house and create fund
    await fundFactory.connect(owner).registerFundHouse(fundHouse.address);
    
    const fundInfo = { ...sampleFundInfo, manager: fundManager.address };
    const tx = await fundFactory.connect(fundHouse).createFund(fundInfo, sampleSuitabilityCriteria);
    const receipt = await tx.wait();
    
    const fundCreatedEvent = receipt.logs.find(log => 
      log.fragment && log.fragment.name === "FundCreated"
    );
    const fundTokenAddress = fundCreatedEvent.args[0];
    fundToken = await ethers.getContractAt("FundToken", fundTokenAddress);    // Authorize oracle and custodian
    await custodyTracker.connect(owner).authorizeOracle(oracle.address, true);
    await custodyTracker.connect(owner).authorizeCustodian(custodian.address, true);

    // Set up marketplace and mint tokens for testing
    await fundToken.connect(fundManager).setMarketplace(owner.address);
    await fundToken.connect(owner).mint(fundManager.address, ethers.parseUnits("100000", 6)); // Mint 100k tokens
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await custodyTracker.owner()).to.equal(owner.address);
    });

    it("Should initialize with correct values", async function () {
      expect(await custodyTracker.getAssetCount()).to.equal(0);
      expect(await custodyTracker.getValuationHistoryCount()).to.equal(0);
    });

    it("Should have correct basis points constant", async function () {
      expect(await custodyTracker.BASIS_POINTS()).to.equal(BASIS_POINTS);
    });

    it("Should have correct minimum valuation", async function () {
      expect(await custodyTracker.MIN_VALUATION()).to.equal(MIN_VALUATION);
    });
  });

  describe("Authorization Management", function () {
    it("Should allow owner to authorize oracle", async function () {
      const newOracle = user1.address;
      await expect(custodyTracker.connect(owner).authorizeOracle(newOracle, true))
        .to.emit(custodyTracker, "OracleAuthorized")
        .withArgs(newOracle, true);
      
      expect(await custodyTracker.authorizedOracles(newOracle)).to.be.true;
    });

    it("Should allow owner to deauthorize oracle", async function () {
      await expect(custodyTracker.connect(owner).authorizeOracle(oracle.address, false))
        .to.emit(custodyTracker, "OracleAuthorized")
        .withArgs(oracle.address, false);
      
      expect(await custodyTracker.authorizedOracles(oracle.address)).to.be.false;
    });

    it("Should allow owner to authorize custodian", async function () {
      const newCustodian = user1.address;
      await expect(custodyTracker.connect(owner).authorizeCustodian(newCustodian, true))
        .to.emit(custodyTracker, "CustodianAuthorized")
        .withArgs(newCustodian, true);
      
      expect(await custodyTracker.authorizedCustodians(newCustodian)).to.be.true;
    });

    it("Should revert when non-owner tries to authorize oracle", async function () {
      await expect(
        custodyTracker.connect(user1).authorizeOracle(user1.address, true)
      ).to.be.revertedWithCustomError(custodyTracker, "OwnableUnauthorizedAccount");
    });

    it("Should revert with invalid oracle address", async function () {
      await expect(
        custodyTracker.connect(owner).authorizeOracle(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Invalid oracle address");
    });

    it("Should revert with invalid custodian address", async function () {
      await expect(
        custodyTracker.connect(owner).authorizeCustodian(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Invalid custodian address");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      await custodyTracker.connect(owner).pause();
      expect(await custodyTracker.paused()).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await custodyTracker.connect(owner).pause();
      await custodyTracker.connect(owner).unpause();
      expect(await custodyTracker.paused()).to.be.false;
    });

    it("Should revert when non-owner tries to pause", async function () {
      await expect(
        custodyTracker.connect(user1).pause()
      ).to.be.revertedWithCustomError(custodyTracker, "OwnableUnauthorizedAccount");
    });

    it("Should prevent asset registration when paused", async function () {
      await custodyTracker.connect(owner).pause();
      
      await expect(
        custodyTracker.connect(owner).registerAsset(
          sampleAsset.assetId,
          sampleAsset.assetType,
          sampleAsset.description,
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWithCustomError(custodyTracker, "EnforcedPause");
    });
  });

  describe("Asset Registration", function () {
    it("Should allow owner to register asset", async function () {
      await expect(
        custodyTracker.connect(owner).registerAsset(
          sampleAsset.assetId,
          sampleAsset.assetType,
          sampleAsset.description,
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.emit(custodyTracker, "AssetRegistered")
        .withArgs(sampleAsset.assetId, sampleAsset.assetType, sampleAsset.valuationUSD);

      const asset = await custodyTracker.getAsset(sampleAsset.assetId);
      expect(asset.assetId).to.equal(sampleAsset.assetId);
      expect(asset.assetType).to.equal(sampleAsset.assetType);
      expect(asset.valuationUSD).to.equal(sampleAsset.valuationUSD);
      expect(asset.isActive).to.be.true;
    });

    it("Should track all registered assets", async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );

      expect(await custodyTracker.getAssetCount()).to.equal(1);
      const allAssets = await custodyTracker.getAllAssets();
      expect(allAssets[0]).to.equal(sampleAsset.assetId);
    });

    it("Should revert when non-owner tries to register asset", async function () {
      await expect(
        custodyTracker.connect(user1).registerAsset(
          sampleAsset.assetId,
          sampleAsset.assetType,
          sampleAsset.description,
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWithCustomError(custodyTracker, "OwnableUnauthorizedAccount");
    });

    it("Should revert with invalid asset ID", async function () {
      await expect(
        custodyTracker.connect(owner).registerAsset(
          "",
          sampleAsset.assetType,
          sampleAsset.description,
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWith("Invalid asset ID");
    });

    it("Should revert with duplicate asset ID", async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );

      await expect(
        custodyTracker.connect(owner).registerAsset(
          sampleAsset.assetId,
          "different_type",
          "Different description",
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWith("Asset already exists");
    });

    it("Should revert with valuation below minimum", async function () {
      await expect(
        custodyTracker.connect(owner).registerAsset(
          sampleAsset.assetId,
          sampleAsset.assetType,
          sampleAsset.description,
          MIN_VALUATION - 1n,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWith("Valuation too low");
    });

    it("Should revert with invalid asset type", async function () {
      await expect(
        custodyTracker.connect(owner).registerAsset(
          sampleAsset.assetId,
          "",
          sampleAsset.description,
          sampleAsset.valuationUSD,
          sampleAsset.custodian,
          sampleAsset.location
        )
      ).to.be.revertedWith("Invalid asset type");
    });
  });

  describe("Asset Valuation Updates", function () {
    beforeEach(async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );
    });

    it("Should allow authorized oracle to update valuation", async function () {
      const newValuation = ethers.parseUnits("1200000", 6); // $1.2M
      const source = "Oracle Price Feed";

      await expect(
        custodyTracker.connect(oracle).updateAssetValuation(
          sampleAsset.assetId,
          newValuation,
          source
        )
      ).to.emit(custodyTracker, "AssetValuationUpdated")
        .withArgs(sampleAsset.assetId, sampleAsset.valuationUSD, newValuation, source);

      const asset = await custodyTracker.getAsset(sampleAsset.assetId);
      expect(asset.valuationUSD).to.equal(newValuation);
    });

    it("Should record valuation history", async function () {
      const newValuation = ethers.parseUnits("1200000", 6);
      const source = "Oracle Price Feed";

      await custodyTracker.connect(oracle).updateAssetValuation(
        sampleAsset.assetId,
        newValuation,
        source
      );

      expect(await custodyTracker.getValuationHistoryCount()).to.equal(1);
      
      const history = await custodyTracker.getValuationHistory(0, 1);
      expect(history[0].assetId).to.equal(sampleAsset.assetId);
      expect(history[0].oldValuation).to.equal(sampleAsset.valuationUSD);
      expect(history[0].newValuation).to.equal(newValuation);
      expect(history[0].updatedBy).to.equal(oracle.address);
    });

    it("Should revert when unauthorized user tries to update valuation", async function () {
      await expect(
        custodyTracker.connect(user1).updateAssetValuation(
          sampleAsset.assetId,
          ethers.parseUnits("1200000", 6),
          "Unauthorized"
        )
      ).to.be.revertedWith("Not authorized oracle");
    });

    it("Should revert when updating non-existent asset", async function () {
      await expect(
        custodyTracker.connect(oracle).updateAssetValuation(
          "NONEXISTENT",
          ethers.parseUnits("1200000", 6),
          "Oracle"
        )
      ).to.be.revertedWith("Asset not found");
    });

    it("Should revert with valuation below minimum", async function () {
      await expect(
        custodyTracker.connect(oracle).updateAssetValuation(
          sampleAsset.assetId,
          MIN_VALUATION - 1n,
          "Oracle"
        )
      ).to.be.revertedWith("Valuation too low");
    });
  });

  describe("Asset Deactivation", function () {
    beforeEach(async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );
    });

    it("Should allow owner to deactivate asset", async function () {
      await custodyTracker.connect(owner).deactivateAsset(sampleAsset.assetId);
      
      const asset = await custodyTracker.getAsset(sampleAsset.assetId);
      expect(asset.isActive).to.be.false;
    });

    it("Should deactivate related custody records", async function () {
      // First create a custody record
      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId,
        ethers.parseUnits("1000", 6),
        5000 // 50%
      );

      // Then deactivate the asset
      await expect(
        custodyTracker.connect(owner).deactivateAsset(sampleAsset.assetId)
      ).to.emit(custodyTracker, "CustodyRecordDeactivated")
        .withArgs(await fundToken.getAddress(), sampleAsset.assetId);
    });

    it("Should revert when non-owner tries to deactivate asset", async function () {
      await expect(
        custodyTracker.connect(user1).deactivateAsset(sampleAsset.assetId)
      ).to.be.revertedWithCustomError(custodyTracker, "OwnableUnauthorizedAccount");
    });
  });

  describe("Custody Record Management", function () {
    beforeEach(async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );      // Set up marketplace and mint some tokens to the fund
      await fundToken.connect(fundManager).setMarketplace(owner.address);
      await fundToken.connect(owner).mint(fundManager.address, ethers.parseUnits("100000", 6)); // Mint 100k tokens
      await custodyTracker.connect(owner).authorizeCustodian(await custodyTracker.getAddress(), true);
    });

    it("Should allow authorized custodian to create custody record", async function () {
      const tokensBacked = ethers.parseUnits("1000", 6);
      const percentage = 5000; // 50%

      await expect(
        custodyTracker.connect(custodian).createCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId,
          tokensBacked,
          percentage
        )
      ).to.emit(custodyTracker, "CustodyRecordCreated")
        .withArgs(await fundToken.getAddress(), sampleAsset.assetId, tokensBacked, percentage);

      const record = await custodyTracker.getCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId
      );
      expect(record.tokensBacked).to.equal(tokensBacked);
      expect(record.percentageAllocation).to.equal(percentage);
      expect(record.isActive).to.be.true;
    });

    it("Should track fund assets and asset funds", async function () {
      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId,
        ethers.parseUnits("1000", 6),
        5000
      );

      const fundAssets = await custodyTracker.getFundAssets(await fundToken.getAddress());
      expect(fundAssets.length).to.equal(1);
      expect(fundAssets[0]).to.equal(sampleAsset.assetId);

      const assetFunds = await custodyTracker.getAssetFunds(sampleAsset.assetId);
      expect(assetFunds.length).to.equal(1);
      expect(assetFunds[0]).to.equal(await fundToken.getAddress());
    });

    it("Should allow updating custody record", async function () {
      const initialTokens = ethers.parseUnits("1000", 6);
      const updatedTokens = ethers.parseUnits("1500", 6);

      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId,
        initialTokens,
        5000
      );

      await expect(
        custodyTracker.connect(custodian).updateCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId,
          updatedTokens
        )
      ).to.emit(custodyTracker, "CustodyRecordUpdated")
        .withArgs(await fundToken.getAddress(), sampleAsset.assetId, initialTokens, updatedTokens);

      const record = await custodyTracker.getCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId
      );
      expect(record.tokensBacked).to.equal(updatedTokens);
    });

    it("Should allow deactivating custody record", async function () {
      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId,
        ethers.parseUnits("1000", 6),
        5000
      );

      await expect(
        custodyTracker.connect(custodian).deactivateCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId
        )
      ).to.emit(custodyTracker, "CustodyRecordDeactivated")
        .withArgs(await fundToken.getAddress(), sampleAsset.assetId);

      const record = await custodyTracker.getCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId
      );
      expect(record.isActive).to.be.false;
    });

    it("Should revert when unauthorized user tries to create custody record", async function () {
      await expect(
        custodyTracker.connect(user1).createCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId,
          ethers.parseUnits("1000", 6),
          5000
        )
      ).to.be.revertedWith("Not authorized custodian");
    });

    it("Should revert with invalid percentage allocation", async function () {
      await expect(
        custodyTracker.connect(custodian).createCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId,
          ethers.parseUnits("1000", 6),
          10001 // > 100%
        )
      ).to.be.revertedWith("Invalid percentage");
    });

    it("Should revert when creating duplicate custody record", async function () {
      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        sampleAsset.assetId,
        ethers.parseUnits("1000", 6),
        5000
      );

      await expect(
        custodyTracker.connect(custodian).createCustodyRecord(
          await fundToken.getAddress(),
          sampleAsset.assetId,
          ethers.parseUnits("500", 6),
          3000
        )
      ).to.be.revertedWith("Custody record already exists");
    });
  });

  describe("Fund Backing Calculations", function () {
    beforeEach(async function () {
      // Register multiple assets
      await custodyTracker.connect(owner).registerAsset(
        "ASSET001",
        "real_estate",
        "Commercial Property",
        ethers.parseUnits("1000000", 6), // $1M
        "Custodian A",
        "Mumbai"
      );

      await custodyTracker.connect(owner).registerAsset(
        "ASSET002",
        "equity",
        "Blue chip stocks",
        ethers.parseUnits("500000", 6), // $500K
        "Custodian B",
        "NYSE"
      );

      // Create custody records
      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        "ASSET001",
        ethers.parseUnits("1000", 6),
        5000 // 50% of asset
      );

      await custodyTracker.connect(custodian).createCustodyRecord(
        await fundToken.getAddress(),
        "ASSET002",
        ethers.parseUnits("500", 6),
        3000 // 30% of asset
      );
    });

    it("Should calculate total fund backing value", async function () {
      const backingValue = await custodyTracker.getFundBackingValue(await fundToken.getAddress());
      
      // Expected: (1M * 50%) + (500K * 30%) = 500K + 150K = 650K
      const expectedValue = ethers.parseUnits("650000", 6);
      expect(backingValue).to.equal(expectedValue);
    });    it("Should calculate fund backing ratio", async function () {
      // Fund has 100K tokens at $100 NAV = $10M total value
      // Backing: $650K
      // Ratio should be: (650K / 10M) * 10000 = 650 basis points (6.5%)
      
      const backingRatio = await custodyTracker.getFundBackingRatio(await fundToken.getAddress());
      expect(backingRatio).to.equal(650); // 6.5% in basis points
    });

    it("Should check if fund is fully backed", async function () {
      const isFullyBacked = await custodyTracker.isFullyBacked(await fundToken.getAddress());
      expect(isFullyBacked).to.be.false; // Only 6.5 basis points backing
    });

    it("Should handle fund with no backing", async function () {
      // Create a new fund with no custody records
      const fundInfo2 = { ...sampleFundInfo, fundName: "Unbacked Fund", manager: fundManager.address };
      const tx = await fundFactory.connect(fundHouse).createFund(fundInfo2, sampleSuitabilityCriteria);
      const receipt = await tx.wait();
      
      const fundCreatedEvent = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "FundCreated"
      );
      const unbackedFundAddress = fundCreatedEvent.args[0];

      const backingValue = await custodyTracker.getFundBackingValue(unbackedFundAddress);
      expect(backingValue).to.equal(0);

      const isFullyBacked = await custodyTracker.isFullyBacked(unbackedFundAddress);
      expect(isFullyBacked).to.be.false;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await custodyTracker.connect(owner).registerAsset(
        sampleAsset.assetId,
        sampleAsset.assetType,
        sampleAsset.description,
        sampleAsset.valuationUSD,
        sampleAsset.custodian,
        sampleAsset.location
      );

      // Add some valuation history
      await custodyTracker.connect(oracle).updateAssetValuation(
        sampleAsset.assetId,
        ethers.parseUnits("1100000", 6),
        "Oracle Update 1"
      );

      await custodyTracker.connect(oracle).updateAssetValuation(
        sampleAsset.assetId,
        ethers.parseUnits("1200000", 6),
        "Oracle Update 2"
      );
    });

    it("Should get valuation history with pagination", async function () {
      const history = await custodyTracker.getValuationHistory(0, 2);
      expect(history.length).to.equal(2);
      
      expect(history[0].newValuation).to.equal(ethers.parseUnits("1100000", 6));
      expect(history[1].newValuation).to.equal(ethers.parseUnits("1200000", 6));
    });

    it("Should handle pagination limits correctly", async function () {
      const firstPage = await custodyTracker.getValuationHistory(0, 1);
      expect(firstPage.length).to.equal(1);

      const secondPage = await custodyTracker.getValuationHistory(1, 1);
      expect(secondPage.length).to.equal(1);
      
      expect(firstPage[0].newValuation).to.not.equal(secondPage[0].newValuation);
    });

    it("Should revert with invalid pagination parameters", async function () {
      await expect(
        custodyTracker.getValuationHistory(0, 0)
      ).to.be.revertedWith("Invalid limit");

      await expect(
        custodyTracker.getValuationHistory(0, 101)
      ).to.be.revertedWith("Invalid limit");

      await expect(
        custodyTracker.getValuationHistory(100, 1)
      ).to.be.revertedWith("Offset out of range");
    });

    it("Should get asset details correctly", async function () {
      const asset = await custodyTracker.getAsset(sampleAsset.assetId);
      
      expect(asset.assetId).to.equal(sampleAsset.assetId);
      expect(asset.assetType).to.equal(sampleAsset.assetType);
      expect(asset.description).to.equal(sampleAsset.description);
      expect(asset.custodian).to.equal(sampleAsset.custodian);
      expect(asset.location).to.equal(sampleAsset.location);
      expect(asset.isActive).to.be.true;
    });

    it("Should revert when getting non-existent asset", async function () {
      await expect(
        custodyTracker.getAsset("NONEXISTENT")
      ).to.be.revertedWith("Asset not found");
    });
  });
});
