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
  let user2;
  let authorizedDeployer;

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
    [owner, fundHouse1, fundHouse2, manager1, manager2, user1, user2, authorizedDeployer] = await ethers.getSigners();
    
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

    it("Should set owner as authorized deployer", async function () {
      expect(await fundFactory.authorizedDeployers(owner.address)).to.equal(true);
    });

    it("Should initialize with correct MAX_FUNDS_PER_HOUSE", async function () {
      expect(await fundFactory.MAX_FUNDS_PER_HOUSE()).to.equal(50);
    });

    it("Should start with zero deployed funds", async function () {
      expect(await fundFactory.getDeployedFundsCount()).to.equal(0);
    });

    it("Should start with zero approved fund houses", async function () {
      expect(await fundFactory.getApprovedFundHousesCount()).to.equal(0);
    });

    it("Should not be paused initially", async function () {
      expect(await fundFactory.paused()).to.equal(false);
    });
  });

  describe("Fund House Registration", function () {
    it("Should allow fund house registration", async function () {
      await expect(fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address))
        .to.emit(fundFactory, "FundHouseRegistered")
        .withArgs(fundHouse1.address, "Alpha Capital");

      const registeredFundHouse = await fundFactory.fundHouses(fundHouse1.address);
      expect(registeredFundHouse.name).to.equal("Alpha Capital");
      expect(registeredFundHouse.manager).to.equal(manager1.address);
      expect(registeredFundHouse.isApproved).to.equal(false);
      expect(registeredFundHouse.isActive).to.equal(true);
      expect(registeredFundHouse.totalFundsCreated).to.equal(0);
    });

    it("Should not allow empty name", async function () {
      await expect(fundFactory.connect(fundHouse1).registerFundHouse("", manager1.address))
        .to.be.revertedWith("Invalid params");
    });

    it("Should not allow zero address as manager", async function () {
      await expect(fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", ethers.ZeroAddress))
        .to.be.revertedWith("Invalid params");
    });

    it("Should not allow duplicate registration", async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      
      await expect(fundFactory.connect(fundHouse1).registerFundHouse("Beta Capital", manager2.address))
        .to.be.revertedWith("Already registered");
    });

    it("Should allow multiple different fund houses to register", async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(fundHouse2).registerFundHouse("Beta Capital", manager2.address);

      const fundHouse1Data = await fundFactory.fundHouses(fundHouse1.address);
      const fundHouse2Data = await fundFactory.fundHouses(fundHouse2.address);

      expect(fundHouse1Data.name).to.equal("Alpha Capital");
      expect(fundHouse2Data.name).to.equal("Beta Capital");
    });
  });

  describe("Fund House Approval", function () {
    beforeEach(async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(fundHouse2).registerFundHouse("Beta Capital", manager2.address);
    });

    it("Should allow owner to approve fund house", async function () {
      await expect(fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true))
        .to.emit(fundFactory, "FundHouseApproved")
        .withArgs(fundHouse1.address, true);

      const fundHouseData = await fundFactory.fundHouses(fundHouse1.address);
      expect(fundHouseData.isApproved).to.equal(true);
      expect(await fundFactory.getApprovedFundHousesCount()).to.equal(1);
    });

    it("Should not allow non-owner to approve fund house", async function () {
      await expect(fundFactory.connect(user1).approveFundHouse(fundHouse1.address, true))
        .to.be.revertedWithCustomError(fundFactory, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should allow owner to revoke approval", async function () {
      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true);
      expect(await fundFactory.getApprovedFundHousesCount()).to.equal(1);

      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, false);
      
      const fundHouseData = await fundFactory.fundHouses(fundHouse1.address);
      expect(fundHouseData.isApproved).to.equal(false);
    });
  });

  describe("Fund Deployment", function () {
    beforeEach(async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true);
    });

    it("Should allow approved fund house to deploy fund", async function () {
      const tokenName = "Alpha Fund Token";
      const tokenSymbol = "AFT";
      
      await expect(fundFactory.connect(fundHouse1).deployFund(
        tokenName,
        tokenSymbol,
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.emit(fundFactory, "FundDeployed");

      expect(await fundFactory.getDeployedFundsCount()).to.equal(1);
      
      const fundHouseData = await fundFactory.fundHouses(fundHouse1.address);
      expect(fundHouseData.totalFundsCreated).to.equal(1);
    });

    it("Should not allow unapproved fund house to deploy fund", async function () {
      await fundFactory.connect(fundHouse2).registerFundHouse("Beta Capital", manager2.address);
      // Don't approve fundHouse2
      
      await expect(fundFactory.connect(fundHouse2).deployFund(
        "Beta Fund Token",
        "BFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Not approved");
    });

    it("Should not allow deployment with empty token name", async function () {
      await expect(fundFactory.connect(fundHouse1).deployFund(
        "",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Invalid params");
    });

    it("Should not allow deployment with empty fund name", async function () {
      const emptyNameFundInfo = { ...sampleFundInfo, fundName: "" };
      
      await expect(fundFactory.connect(fundHouse1).deployFund(
        "Alpha Fund Token",
        "AFT",
        emptyNameFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Invalid params");
    });

    it("Should not allow deployment with duplicate fund name", async function () {
      await fundFactory.connect(fundHouse1).deployFund(
        "Alpha Fund Token",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      );

      await expect(fundFactory.connect(fundHouse1).deployFund(
        "Alpha Fund Token 2",
        "AFT2",
        sampleFundInfo, // Same fund name
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Name exists");
    });

    it("Should not allow deployment when paused", async function () {
      await fundFactory.connect(owner).setPaused(true);
      
      await expect(fundFactory.connect(fundHouse1).deployFund(
        "Alpha Fund Token",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Paused");
    });
  });

  describe("Authorized Deployer Functions", function () {
    beforeEach(async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true);
      await fundFactory.connect(owner).addAuthorizedDeployer(authorizedDeployer.address);
    });

    it("Should allow owner to add authorized deployer", async function () {
      await expect(fundFactory.connect(owner).addAuthorizedDeployer(user1.address))
        .to.emit(fundFactory, "AuthorizedDeployerAdded")
        .withArgs(user1.address);

      expect(await fundFactory.authorizedDeployers(user1.address)).to.equal(true);
    });

    it("Should not allow adding zero address as deployer", async function () {
      await expect(fundFactory.connect(owner).addAuthorizedDeployer(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid");
    });

    it("Should not allow adding already authorized deployer", async function () {
      await expect(fundFactory.connect(owner).addAuthorizedDeployer(authorizedDeployer.address))
        .to.be.revertedWith("Invalid");
    });

    it("Should allow authorized deployer to deploy fund for house", async function () {
      await expect(fundFactory.connect(authorizedDeployer).deployFundForHouse(
        fundHouse1.address,
        "Alpha Fund Token",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.emit(fundFactory, "FundDeployed");

      expect(await fundFactory.getDeployedFundsCount()).to.equal(1);
    });

    it("Should not allow unauthorized user to deploy fund for house", async function () {
      await expect(fundFactory.connect(user1).deployFundForHouse(
        fundHouse1.address,
        "Alpha Fund Token",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      ))
        .to.be.revertedWith("Not authorized");
    });

    it("Should allow removing authorized deployer", async function () {
      await fundFactory.connect(owner).removeAuthorizedDeployer(authorizedDeployer.address);
      expect(await fundFactory.authorizedDeployers(authorizedDeployer.address)).to.equal(false);
    });

    it("Should not allow removing owner as deployer", async function () {
      await expect(fundFactory.connect(owner).removeAuthorizedDeployer(owner.address))
        .to.be.revertedWith("Invalid");
    });
  });

  describe("Admin Functions", function () {
    beforeEach(async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true);
    });

    it("Should allow owner to pause contract", async function () {
      await fundFactory.connect(owner).setPaused(true);
      expect(await fundFactory.paused()).to.equal(true);
    });

    it("Should allow owner to unpause contract", async function () {
      await fundFactory.connect(owner).setPaused(true);
      await fundFactory.connect(owner).setPaused(false);
      expect(await fundFactory.paused()).to.equal(false);
    });

    it("Should not allow non-owner to pause contract", async function () {
      await expect(fundFactory.connect(user1).setPaused(true))
        .to.be.revertedWithCustomError(fundFactory, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should allow owner to toggle fund house status", async function () {
      await fundFactory.connect(owner).toggleFundHouseStatus(fundHouse1.address);
      
      const fundHouseData = await fundFactory.fundHouses(fundHouse1.address);
      expect(fundHouseData.isActive).to.equal(false);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await fundFactory.connect(fundHouse1).registerFundHouse("Alpha Capital", manager1.address);
      await fundFactory.connect(fundHouse2).registerFundHouse("Beta Capital", manager2.address);
      await fundFactory.connect(owner).approveFundHouse(fundHouse1.address, true);
      await fundFactory.connect(owner).approveFundHouse(fundHouse2.address, true);

      // Deploy a couple of funds
      await fundFactory.connect(fundHouse1).deployFund(
        "Alpha Fund Token",
        "AFT",
        sampleFundInfo,
        sampleSuitabilityCriteria
      );

      const secondFundInfo = { ...sampleFundInfo, fundName: "Beta Private Equity Fund", manager: manager2.address };
      await fundFactory.connect(fundHouse2).deployFund(
        "Beta Fund Token",
        "BFT",
        secondFundInfo,
        sampleSuitabilityCriteria
      );
    });

    it("Should return correct deployed funds count", async function () {
      expect(await fundFactory.getDeployedFundsCount()).to.equal(2);
    });

    it("Should return correct approved fund houses count", async function () {
      expect(await fundFactory.getApprovedFundHousesCount()).to.equal(2);
    });

    it("Should return funds by house", async function () {
      const fundHouse1Funds = await fundFactory.getFundsByHouse(fundHouse1.address);
      expect(fundHouse1Funds.length).to.equal(1);
    });

    it("Should validate fund house correctly", async function () {
      expect(await fundFactory.isFundHouseValid(fundHouse1.address)).to.equal(true);
      
      // Toggle status and check again
      await fundFactory.connect(owner).toggleFundHouseStatus(fundHouse1.address);
      expect(await fundFactory.isFundHouseValid(fundHouse1.address)).to.equal(false);
    });

    it("Should get fund by name", async function () {
      const [fundAddress, fundInfo] = await fundFactory.getFundByName("Test Private Equity Fund");
      
      expect(fundAddress).to.not.equal(ethers.ZeroAddress);
      expect(fundInfo.fundName).to.equal("Test Private Equity Fund");
      expect(fundInfo.fundHouse).to.equal(fundHouse1.address);
    });

    it("Should return zero address for non-existent fund name", async function () {
      const [fundAddress, ] = await fundFactory.getFundByName("Non-existent Fund");
      expect(fundAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should get paginated deployed funds", async function () {
      const [funds, total] = await fundFactory.getDeployedFundsPaginated(0, 10);
      
      expect(total).to.equal(2);
      expect(funds.length).to.equal(2);
    });

    it("Should handle pagination correctly for deployed funds", async function () {
      const [funds, total] = await fundFactory.getDeployedFundsPaginated(0, 1);
      
      expect(total).to.equal(2);
      expect(funds.length).to.equal(1);
    });

    it("Should return empty array for out of range pagination", async function () {
      const [funds, total] = await fundFactory.getDeployedFundsPaginated(10, 5);
      
      expect(total).to.equal(2);
      expect(funds.length).to.equal(0);
    });

    it("Should get paginated approved fund houses", async function () {
      const [houses, total] = await fundFactory.getApprovedFundHousesPaginated(0, 10);
      
      expect(total).to.equal(2);
      expect(houses.length).to.equal(2);
    });
  });
});
