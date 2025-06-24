const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FundFactory", function () {
  let fundFactory;
  let owner;
  let fundHouse1;
  let fundHouse2;
  let manager1;
  let manager2;
  let user1;

  // Test data structures
  const sampleFundInfo = {
    fundName: "Test Private Equity Fund",
    fundType: "private_equity",
    description: "A test fund for factory deployment",
    manager: "", // Will be set dynamically
    minimumInvestment: ethers.parseUnits("100000", 6), // 100k USDC minimum
    currentNAV: ethers.parseUnits("100", 6), // $100 per token
    totalAssetValue: ethers.parseUnits("10000000", 6), // $10M total assets
    isActive: true,
    createdAt: 0 // Will be set by contract
  };

  const sampleSuitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate",
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "SG", "US"],
    isActive: true
  };

  beforeEach(async function () {
    [owner, fundHouse1, fundHouse2, manager1, manager2, user1] = await ethers.getSigners();
    
    const FundFactory = await ethers.getContractFactory("FundFactory");
    fundFactory = await FundFactory.deploy(owner.address);
    await fundFactory.waitForDeployment();
    
    // Set manager addresses in fund info
    sampleFundInfo.manager = manager1.address;
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await fundFactory.owner()).to.equal(owner.address);
    });

    it("Should initialize with correct values", async function () {
      expect(await fundFactory.getFundCount()).to.equal(0);
    });
  });

  describe("Fund House Registration", function () {
    it("Should allow owner to register fund house", async function () {
      await expect(fundFactory.connect(owner).registerFundHouse(fundHouse1.address))
        .to.emit(fundFactory, "FundHouseRegistered")
        .withArgs(fundHouse1.address);

      expect(await fundFactory.registeredFundHouses(fundHouse1.address)).to.be.true;
    });

    it("Should revert when non-owner tries to register fund house", async function () {
      await expect(
        fundFactory.connect(fundHouse1).registerFundHouse(fundHouse1.address)
      ).to.be.revertedWithCustomError(fundFactory, "OwnableUnauthorizedAccount");
    });

    it("Should revert with invalid fund house address", async function () {
      await expect(
        fundFactory.connect(owner).registerFundHouse(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });

    it("Should check fund house registration status", async function () {
      expect(await fundFactory.isFundHouseRegistered(fundHouse1.address)).to.be.false;
      
      await fundFactory.connect(owner).registerFundHouse(fundHouse1.address);
      
      expect(await fundFactory.isFundHouseRegistered(fundHouse1.address)).to.be.true;
    });
  });

  describe("Fund Creation", function () {
    beforeEach(async function () {
      // Register fund house first
      await fundFactory.connect(owner).registerFundHouse(fundHouse1.address);
    });

    it("Should allow registered fund house to create fund", async function () {
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      
      await expect(
        fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria)
      ).to.emit(fundFactory, "FundCreated");

      expect(await fundFactory.getFundCount()).to.equal(1);
      
      const fundAddress = await fundFactory.getFundByName(fundInfo.fundName);
      expect(fundAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should revert when unregistered fund house tries to create fund", async function () {
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      
      await expect(
        fundFactory.connect(fundHouse2).createFund(fundInfo, sampleSuitabilityCriteria)
      ).to.be.revertedWith("Not registered");
    });

    it("Should revert with invalid fund name", async function () {
      const fundInfo = { ...sampleFundInfo, fundName: "", manager: manager1.address };
      
      await expect(
        fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria)
      ).to.be.revertedWith("Invalid name");
    });

    it("Should revert when creating fund with duplicate name", async function () {
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      
      // Create first fund
      await fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria);
      
      // Try to create second fund with same name
      await expect(
        fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria)
      ).to.be.revertedWith("Name exists");
    });

    it("Should create fund with correct token name and symbol", async function () {
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      
      const tx = await fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria);
      const receipt = await tx.wait();
      
      // Get the fund address from the event
      const fundCreatedEvent = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "FundCreated"
      );
      const fundAddress = fundCreatedEvent.args[0];
      
      // Check the created fund token
      const fundToken = await ethers.getContractAt("FundToken", fundAddress);
      expect(await fundToken.name()).to.equal(fundInfo.fundName + " Token");
      expect(await fundToken.symbol()).to.equal(fundInfo.fundType + "T");
    });

    it("Should track multiple funds correctly", async function () {
      const fundInfo1 = { ...sampleFundInfo, fundName: "Fund 1", manager: manager1.address };
      const fundInfo2 = { ...sampleFundInfo, fundName: "Fund 2", manager: manager1.address };
      
      await fundFactory.connect(fundHouse1).createFund(fundInfo1, sampleSuitabilityCriteria);
      await fundFactory.connect(fundHouse1).createFund(fundInfo2, sampleSuitabilityCriteria);
      
      expect(await fundFactory.getFundCount()).to.equal(2);
      
      const fund1Address = await fundFactory.getFundByName("Fund 1");
      const fund2Address = await fundFactory.getFundByName("Fund 2");
      
      expect(fund1Address).to.not.equal(ethers.ZeroAddress);
      expect(fund2Address).to.not.equal(ethers.ZeroAddress);
      expect(fund1Address).to.not.equal(fund2Address);
    });

    it("Should return zero address for non-existent fund name", async function () {
      const fundAddress = await fundFactory.getFundByName("Non-existent Fund");
      expect(fundAddress).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Fund Token Integration", function () {
    let fundToken;

    beforeEach(async function () {
      await fundFactory.connect(owner).registerFundHouse(fundHouse1.address);
      
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      const tx = await fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria);
      const receipt = await tx.wait();
      
      const fundCreatedEvent = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "FundCreated"
      );
      const fundAddress = fundCreatedEvent.args[0];
      fundToken = await ethers.getContractAt("FundToken", fundAddress);
    });

    it("Should create fund token with correct initial state", async function () {
      const fundInfo = await fundToken.getFundInfo();
      
      expect(fundInfo.fundName).to.equal(sampleFundInfo.fundName);
      expect(fundInfo.fundType).to.equal(sampleFundInfo.fundType);
      expect(fundInfo.manager).to.equal(manager1.address);
      expect(fundInfo.minimumInvestment).to.equal(sampleFundInfo.minimumInvestment);
      expect(fundInfo.currentNAV).to.equal(sampleFundInfo.currentNAV);
      expect(fundInfo.isActive).to.be.true;
    });    it("Should create fund token with correct ownership", async function () {
      // The fund token should be owned by the fund manager after creation
      expect(await fundToken.owner()).to.equal(manager1.address);
    });

    it("Should have correct initial token supply", async function () {
      // Initial supply should be 0
      expect(await fundToken.totalSupply()).to.equal(0);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await fundFactory.connect(owner).registerFundHouse(fundHouse1.address);
      await fundFactory.connect(owner).registerFundHouse(fundHouse2.address);
    });

    it("Should track fund count correctly", async function () {
      expect(await fundFactory.getFundCount()).to.equal(0);
      
      const fundInfo1 = { ...sampleFundInfo, fundName: "Fund 1", manager: manager1.address };
      await fundFactory.connect(fundHouse1).createFund(fundInfo1, sampleSuitabilityCriteria);
      expect(await fundFactory.getFundCount()).to.equal(1);
      
      const fundInfo2 = { ...sampleFundInfo, fundName: "Fund 2", manager: manager2.address };
      await fundFactory.connect(fundHouse2).createFund(fundInfo2, sampleSuitabilityCriteria);
      expect(await fundFactory.getFundCount()).to.equal(2);
    });

    it("Should find funds by name correctly", async function () {
      const fundInfo = { ...sampleFundInfo, manager: manager1.address };
      await fundFactory.connect(fundHouse1).createFund(fundInfo, sampleSuitabilityCriteria);
      
      const fundAddress = await fundFactory.getFundByName(fundInfo.fundName);
      expect(fundAddress).to.not.equal(ethers.ZeroAddress);
      
      const fundToken = await ethers.getContractAt("FundToken", fundAddress);
      const retrievedFundInfo = await fundToken.getFundInfo();
      expect(retrievedFundInfo.fundName).to.equal(fundInfo.fundName);
    });

    it("Should correctly report fund house registration status", async function () {
      expect(await fundFactory.isFundHouseRegistered(fundHouse1.address)).to.be.true;
      expect(await fundFactory.isFundHouseRegistered(fundHouse2.address)).to.be.true;
      expect(await fundFactory.isFundHouseRegistered(user1.address)).to.be.false;
    });
  });
});
