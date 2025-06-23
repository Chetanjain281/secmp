const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FundToken", function () {
  let fundToken;
  let owner;
  let manager;
  let user1;
  let user2;
  let marketplace;

  // Test data structures
  const fundInfo = {
    fundName: "Test Private Equity Fund",
    fundType: "private_equity",
    description: "A test fund for POC purposes",
    manager: "", // Will be set to manager.address
    minimumInvestment: ethers.parseUnits("100000", 6), // 100k USDC minimum
    currentNAV: ethers.parseUnits("100", 6), // $100 per token
    totalAssetValue: ethers.parseUnits("10000000", 6), // $10M total assets
    isActive: true,
    createdAt: 0 // Will be set by contract
  };

  const suitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate",
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "SG", "US"],
    isActive: true
  };

  beforeEach(async function () {
    [owner, manager, user1, user2, marketplace] = await ethers.getSigners();
    
    // Set manager address in fund info
    fundInfo.manager = manager.address;
    
    const FundToken = await ethers.getContractFactory("FundToken");
    fundToken = await FundToken.deploy(
      "Test Fund Token",
      "TFT",
      fundInfo,
      suitabilityCriteria
    );
    await fundToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct fund parameters", async function () {
      const deployedFundInfo = await fundToken.fundInfo();
      
      expect(deployedFundInfo.fundName).to.equal("Test Private Equity Fund");
      expect(deployedFundInfo.fundType).to.equal("private_equity");
      expect(deployedFundInfo.manager).to.equal(manager.address);
      expect(deployedFundInfo.minimumInvestment).to.equal(ethers.parseUnits("100000", 6));
      expect(deployedFundInfo.currentNAV).to.equal(ethers.parseUnits("100", 6));
      expect(deployedFundInfo.isActive).to.equal(true);
    });

    it("Should set correct token name and symbol", async function () {
      expect(await fundToken.name()).to.equal("Test Fund Token");
      expect(await fundToken.symbol()).to.equal("TFT");
    });

    it("Should set deployer as owner", async function () {
      expect(await fundToken.owner()).to.equal(owner.address);
    });

    it("Should start with zero total supply", async function () {
      expect(await fundToken.totalSupply()).to.equal(0);
    });

    it("Should record initial NAV in history", async function () {
      const historyCount = await fundToken.getNAVHistoryCount();
      expect(historyCount).to.equal(1);
      
      const firstEntry = await fundToken.getNAVHistoryEntry(0);
      expect(firstEntry.nav).to.equal(ethers.parseUnits("100", 6));
      expect(firstEntry.source).to.equal("initial");
    });
  });

  describe("NAV Management", function () {    it("Should allow manager to update NAV", async function () {
      const newNAV = ethers.parseUnits("105", 6); // $105 per token
      const oldNAV = ethers.parseUnits("100", 6);
      
      // Check the transaction emits the event with correct first 3 args (ignoring timestamp)
      const tx = await fundToken.connect(manager).updateNAV(newNAV, "manual");
      
      // Verify event was emitted with proper event filter
      const events = await fundToken.queryFilter("NAVUpdated");
      const latestEvent = events[events.length - 1];
      
      expect(latestEvent.args[0]).to.equal(newNAV); // newNAV
      expect(latestEvent.args[1]).to.equal(oldNAV); // oldNAV  
      expect(latestEvent.args[2]).to.equal("manual"); // source
      expect(latestEvent.args[3]).to.be.gt(0); // timestamp should be positive

      expect(await fundToken.getCurrentNAV()).to.equal(newNAV);
    });

    it("Should allow owner to update NAV", async function () {
      const newNAV = ethers.parseUnits("95", 6);
      
      await fundToken.connect(owner).updateNAV(newNAV, "oracle");
      expect(await fundToken.getCurrentNAV()).to.equal(newNAV);
    });

    it("Should not allow non-manager/non-owner to update NAV", async function () {
      const newNAV = ethers.parseUnits("105", 6);
      
      await expect(fundToken.connect(user1).updateNAV(newNAV, "manual"))
        .to.be.revertedWith("FundToken: only manager or owner");
    });

    it("Should not allow zero NAV", async function () {
      await expect(fundToken.connect(manager).updateNAV(0, "manual"))
        .to.be.revertedWith("FundToken: NAV must be positive");
    });

    it("Should maintain NAV history", async function () {
      // Update NAV multiple times
      await fundToken.connect(manager).updateNAV(ethers.parseUnits("105", 6), "manual");
      await fundToken.connect(manager).updateNAV(ethers.parseUnits("110", 6), "oracle");
      
      const historyCount = await fundToken.getNAVHistoryCount();
      expect(historyCount).to.equal(3); // Initial + 2 updates
      
      const latestEntries = await fundToken.getLatestNAVHistory(2);
      expect(latestEntries[0].nav).to.equal(ethers.parseUnits("105", 6));
      expect(latestEntries[1].nav).to.equal(ethers.parseUnits("110", 6));
    });
  });

  describe("Marketplace Integration", function () {
    beforeEach(async function () {
      await fundToken.connect(owner).setMarketplace(marketplace.address);
    });

    it("Should allow marketplace to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 18); // 1000 tokens
      
      await expect(fundToken.connect(marketplace).mint(user1.address, mintAmount))
        .to.emit(fundToken, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);

      expect(await fundToken.balanceOf(user1.address)).to.equal(mintAmount);
      expect(await fundToken.totalSupply()).to.equal(mintAmount);
    });

    it("Should allow marketplace to burn tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 18);
      const burnAmount = ethers.parseUnits("500", 18);
      
      // First mint tokens
      await fundToken.connect(marketplace).mint(user1.address, mintAmount);
      
      // Then burn some
      await expect(fundToken.connect(marketplace).burn(user1.address, burnAmount))
        .to.emit(fundToken, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, burnAmount);

      expect(await fundToken.balanceOf(user1.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should not allow non-marketplace to mint tokens", async function () {
      const mintAmount = ethers.parseUnits("1000", 18);
      
      await expect(fundToken.connect(user1).mint(user1.address, mintAmount))
        .to.be.revertedWith("FundToken: only marketplace");
    });

    it("Should not allow minting when fund is inactive", async function () {
      await fundToken.connect(manager).toggleFundStatus(); // Make inactive
      
      const mintAmount = ethers.parseUnits("1000", 18);
      await expect(fundToken.connect(marketplace).mint(user1.address, mintAmount))
        .to.be.revertedWith("FundToken: fund is not active");
    });
  });

  describe("Fund Management", function () {
    it("Should allow manager to update fund description", async function () {
      const newDescription = "Updated fund description";
      
      await expect(fundToken.connect(manager).updateFundInfo("description", newDescription))
        .to.emit(fundToken, "FundInfoUpdated")
        .withArgs("description", "A test fund for POC purposes", newDescription);
    });

    it("Should allow manager to update minimum investment", async function () {
      const newMinimum = ethers.parseUnits("200000", 6); // 200k USDC
      
      await fundToken.connect(manager).updateMinimumInvestment(newMinimum);
      
      const fundInfo = await fundToken.fundInfo();
      expect(fundInfo.minimumInvestment).to.equal(newMinimum);
    });

    it("Should allow manager to toggle fund status", async function () {
      await expect(fundToken.connect(manager).toggleFundStatus())
        .to.emit(fundToken, "FundStatusChanged")
        .withArgs(false); // Now inactive

      const fundInfo = await fundToken.fundInfo();
      expect(fundInfo.isActive).to.equal(false);
    });

    it("Should not allow non-manager to update fund info", async function () {
      await expect(fundToken.connect(user1).updateFundInfo("description", "Hacked description"))
        .to.be.revertedWith("FundToken: only fund manager");
    });
  });

  describe("Suitability Checking", function () {
    it("Should approve suitable investor", async function () {
      const isSuitable = await fundToken.checkSuitability(
        "1Cr+",        // income level
        "expert",      // experience
        "aggressive",  // risk tolerance
        "IN"          // geography
      );
      
      expect(isSuitable).to.equal(true);
    });

    it("Should reject investor with insufficient income", async function () {
      const isSuitable = await fundToken.checkSuitability(
        "50L+",       // Below required 1Cr+
        "expert",
        "aggressive",
        "IN"
      );
      
      expect(isSuitable).to.equal(false);
    });

    it("Should reject investor with insufficient experience", async function () {
      const isSuitable = await fundToken.checkSuitability(
        "5Cr+",
        "beginner",   // Below required intermediate
        "aggressive",
        "IN"
      );
      
      expect(isSuitable).to.equal(false);
    });

    it("Should reject investor with wrong risk tolerance", async function () {
      const isSuitable = await fundToken.checkSuitability(
        "5Cr+",
        "expert",
        "conservative", // Not in allowed list
        "IN"
      );
      
      expect(isSuitable).to.equal(false);
    });

    it("Should reject investor from restricted geography", async function () {
      const isSuitable = await fundToken.checkSuitability(
        "5Cr+",
        "expert",
        "aggressive",
        "CN"          // Not in allowed list
      );
      
      expect(isSuitable).to.equal(false);
    });
  });

  describe("Access Control & Security", function () {
    it("Should allow owner to pause contract", async function () {
      await fundToken.connect(owner).pause();
      
      // Set marketplace first
      await fundToken.connect(owner).setMarketplace(marketplace.address);
      
      // Should not allow minting when paused
      await expect(fundToken.connect(marketplace).mint(user1.address, 1000))
        .to.be.revertedWithCustomError(fundToken, "EnforcedPause");
    });

    it("Should allow owner to set marketplace", async function () {
      await expect(fundToken.connect(owner).setMarketplace(marketplace.address))
        .to.emit(fundToken, "MarketplaceSet")
        .withArgs(ethers.ZeroAddress, marketplace.address);
    });

    it("Should not allow non-owner to set marketplace", async function () {
      await expect(fundToken.connect(user1).setMarketplace(marketplace.address))
        .to.be.revertedWithCustomError(fundToken, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should enforce fund active status for transfers", async function () {
      // Set marketplace and mint tokens
      await fundToken.connect(owner).setMarketplace(marketplace.address);
      await fundToken.connect(marketplace).mint(user1.address, ethers.parseUnits("1000", 18));
      
      // Deactivate fund
      await fundToken.connect(manager).toggleFundStatus();
      
      // Should not allow transfers when fund is inactive
      await expect(fundToken.connect(user1).transfer(user2.address, ethers.parseUnits("100", 18)))
        .to.be.revertedWith("FundToken: fund is not active");
    });
  });
});
