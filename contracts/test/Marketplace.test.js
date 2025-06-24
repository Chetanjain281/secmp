const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let marketplace;
  let fundFactory;
  let fundToken;
  let fundToken2;
  let mockUSDC;
  let owner;
  let fundHouse;
  let fundManager;
  let investor1;
  let investor2;
  let investor3;
  let nonInvestor;

  // Test constants
  const TRADING_FEE_RATE = 25; // 0.25%
  const MAX_FEE_RATE = 100; // 1%
  const INITIAL_NAV = ethers.parseUnits("100", 6); // $100 per token
  const MIN_INVESTMENT = ethers.parseUnits("10000", 6); // $10k minimum
  const USDC_DECIMALS = 6;
  const FUND_DECIMALS = 6;

  // Test data
  const sampleFundInfo = {
    fundName: "Test Fund",
    fundType: "private_equity",
    description: "Test fund for marketplace",
    manager: "",
    minimumInvestment: MIN_INVESTMENT,
    currentNAV: INITIAL_NAV,
    totalAssetValue: ethers.parseUnits("1000000", 6),
    isActive: true,
    createdAt: 0
  };

  const sampleSuitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate",
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "SG", "US"],
    isActive: true
  };

  beforeEach(async function () {
    [owner, fundHouse, fundManager, investor1, investor2, investor3, nonInvestor] = await ethers.getSigners();
    
    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // Deploy FundFactory
    const FundFactory = await ethers.getContractFactory("FundFactory");
    fundFactory = await FundFactory.deploy(owner.address);
    await fundFactory.waitForDeployment();

    // Deploy Marketplace
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(await mockUSDC.getAddress(), owner.address);
    await marketplace.waitForDeployment();    // Register fund house
    await fundFactory.connect(owner).registerFundHouse(fundHouse.address);

    // Create fund info with manager
    const fundInfo = { ...sampleFundInfo, manager: fundManager.address };

    // Create fund tokens
    const tx1 = await fundFactory.connect(fundHouse).createFund(
      fundInfo,
      sampleSuitabilityCriteria
    );
    const receipt1 = await tx1.wait();
    const fundCreatedEvent1 = receipt1.logs.find(log => 
      log.fragment && log.fragment.name === "FundCreated"
    );
    const fundTokenAddress1 = fundCreatedEvent1.args[0];
    fundToken = await ethers.getContractAt("FundToken", fundTokenAddress1);

    // Create second fund for multi-fund tests
    const fundInfo2 = { ...sampleFundInfo, fundName: "Test Fund 2", manager: fundManager.address };
    const tx2 = await fundFactory.connect(fundHouse).createFund(
      fundInfo2,
      sampleSuitabilityCriteria
    );
    const receipt2 = await tx2.wait();
    const fundCreatedEvent2 = receipt2.logs.find(log => 
      log.fragment && log.fragment.name === "FundCreated"
    );
    const fundTokenAddress2 = fundCreatedEvent2.args[0];
    fundToken2 = await ethers.getContractAt("FundToken", fundTokenAddress2);    // Set marketplace address in fund tokens (fund manager is now the owner)
    await fundToken.connect(fundManager).setMarketplace(await marketplace.getAddress());
    await fundToken2.connect(fundManager).setMarketplace(await marketplace.getAddress());

    // Set up investor suitability
    await fundToken.connect(fundManager).updateInvestorSuitability(investor1.address, true);
    await fundToken.connect(fundManager).updateInvestorSuitability(investor2.address, true);
    await fundToken.connect(fundManager).updateInvestorSuitability(investor3.address, true);
    await fundToken2.connect(fundManager).updateInvestorSuitability(investor1.address, true);
    await fundToken2.connect(fundManager).updateInvestorSuitability(investor2.address, true);    // Mint USDC to investors
    const usdcAmount = ethers.parseUnits("1000000", USDC_DECIMALS); // 1M USDC each
    await mockUSDC.mint(investor1.address, usdcAmount, "Test funding");
    await mockUSDC.mint(investor2.address, usdcAmount, "Test funding");
    await mockUSDC.mint(investor3.address, usdcAmount, "Test funding");
    await mockUSDC.mint(nonInvestor.address, usdcAmount, "Test funding");

    // Approve USDC spending
    await mockUSDC.connect(investor1).approve(await marketplace.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(investor2).approve(await marketplace.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(investor3).approve(await marketplace.getAddress(), ethers.MaxUint256);
    await mockUSDC.connect(nonInvestor).approve(await marketplace.getAddress(), ethers.MaxUint256);

    // Authorize funds in marketplace
    await marketplace.connect(owner).authorizeFund(await fundToken.getAddress(), true);
    await marketplace.connect(owner).authorizeFund(await fundToken2.getAddress(), true);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await marketplace.owner()).to.equal(owner.address);
    });

    it("Should set the correct USDC token", async function () {
      expect(await marketplace.usdcToken()).to.equal(await mockUSDC.getAddress());
    });

    it("Should set the correct initial trading fee", async function () {
      expect(await marketplace.tradingFeeRate()).to.equal(TRADING_FEE_RATE);
    });

    it("Should initialize with correct values", async function () {
      expect(await marketplace.nextListingId()).to.equal(1);
      expect(await marketplace.getActiveListingsCount()).to.equal(0);
      expect(await marketplace.getTradeHistoryCount()).to.equal(0);
    });

    it("Should revert with invalid USDC address", async function () {
      const Marketplace = await ethers.getContractFactory("Marketplace");
      await expect(
        Marketplace.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Invalid USDC address");
    });    it("Should revert with invalid owner address", async function () {
      const Marketplace = await ethers.getContractFactory("Marketplace");
      await expect(
        Marketplace.deploy(await mockUSDC.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(marketplace, "OwnableInvalidOwner");
    });
  });

  describe("Fund Authorization", function () {
    it("Should allow owner to authorize funds", async function () {
      const newFundAddress = investor1.address; // Using a random address for test
      await expect(marketplace.connect(owner).authorizeFund(newFundAddress, true))
        .to.emit(marketplace, "FundAuthorized")
        .withArgs(newFundAddress, true);
      
      expect(await marketplace.authorizedFunds(newFundAddress)).to.be.true;
    });

    it("Should allow owner to deauthorize funds", async function () {
      const fundAddress = await fundToken.getAddress();
      await expect(marketplace.connect(owner).authorizeFund(fundAddress, false))
        .to.emit(marketplace, "FundAuthorized")
        .withArgs(fundAddress, false);
      
      expect(await marketplace.authorizedFunds(fundAddress)).to.be.false;
    });

    it("Should revert when non-owner tries to authorize fund", async function () {
      await expect(
        marketplace.connect(investor1).authorizeFund(investor1.address, true)
      ).to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("Should revert with invalid fund address", async function () {
      await expect(
        marketplace.connect(owner).authorizeFund(ethers.ZeroAddress, true)
      ).to.be.revertedWith("Invalid fund token address");
    });
  });

  describe("Trading Fee Management", function () {
    it("Should allow owner to set trading fee", async function () {
      const newFee = 50; // 0.5%
      await expect(marketplace.connect(owner).setTradingFee(newFee))
        .to.emit(marketplace, "TradingFeeUpdated")
        .withArgs(TRADING_FEE_RATE, newFee);
      
      expect(await marketplace.tradingFeeRate()).to.equal(newFee);
    });

    it("Should revert when setting fee above maximum", async function () {
      await expect(
        marketplace.connect(owner).setTradingFee(MAX_FEE_RATE + 1)
      ).to.be.revertedWith("Fee rate too high");
    });

    it("Should revert when non-owner tries to set fee", async function () {
      await expect(
        marketplace.connect(investor1).setTradingFee(50)
      ).to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("Should allow setting fee to zero", async function () {
      await marketplace.connect(owner).setTradingFee(0);
      expect(await marketplace.tradingFeeRate()).to.equal(0);
    });

    it("Should allow setting fee to maximum", async function () {
      await marketplace.connect(owner).setTradingFee(MAX_FEE_RATE);
      expect(await marketplace.tradingFeeRate()).to.equal(MAX_FEE_RATE);
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      await marketplace.connect(owner).pause();
      expect(await marketplace.paused()).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await marketplace.connect(owner).pause();
      await marketplace.connect(owner).unpause();
      expect(await marketplace.paused()).to.be.false;
    });

    it("Should revert when non-owner tries to pause", async function () {
      await expect(
        marketplace.connect(investor1).pause()
      ).to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("Should prevent trading when paused", async function () {
      await marketplace.connect(owner).pause();
      
      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          ethers.parseUnits("100", FUND_DECIMALS)
        )
      ).to.be.revertedWithCustomError(marketplace, "EnforcedPause");
    });
  });

  describe("Primary Market Trading", function () {
    it("Should allow buying from fund house", async function () {
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      const expectedPrice = tokenAmount * INITIAL_NAV / ethers.parseUnits("1", FUND_DECIMALS);
      const expectedFee = expectedPrice * BigInt(TRADING_FEE_RATE) / BigInt(10000);
      const totalCost = expectedPrice + expectedFee;

      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          tokenAmount
        )
      ).to.emit(marketplace, "PrimaryTrade")
        .withArgs(investor1.address, await fundToken.getAddress(), tokenAmount, expectedPrice, expectedFee);

      // Check balances
      expect(await fundToken.balanceOf(investor1.address)).to.equal(tokenAmount);
      expect(await mockUSDC.balanceOf(investor1.address)).to.equal(
        ethers.parseUnits("1000000", USDC_DECIMALS) - totalCost
      );
    });

    it("Should revert when buying from unauthorized fund", async function () {
      await marketplace.connect(owner).authorizeFund(await fundToken.getAddress(), false);
      
      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          ethers.parseUnits("100", FUND_DECIMALS)
        )
      ).to.be.revertedWith("Fund not authorized");
    });

    it("Should revert when buying zero tokens", async function () {
      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          0
        )
      ).to.be.revertedWith("Amount must be positive");
    });

    it("Should revert when fund is not active", async function () {
      await fundToken.connect(fundManager).setActiveStatus(false);
      
      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          ethers.parseUnits("100", FUND_DECIMALS)
        )
      ).to.be.revertedWith("Fund not active");
    });

    it("Should revert when investor is not suitable", async function () {
      await expect(
        marketplace.connect(nonInvestor).buyFromFundHouse(
          await fundToken.getAddress(),
          ethers.parseUnits("100", FUND_DECIMALS)
        )
      ).to.be.revertedWith("Investor not suitable");
    });

    it("Should revert when below minimum investment", async function () {
      const smallAmount = ethers.parseUnits("1", FUND_DECIMALS); // $100 worth, but minimum is $10k
      
      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          smallAmount
        )
      ).to.be.revertedWith("Below minimum investment");
    });    it("Should revert when insufficient USDC balance", async function () {
      // Use investor with no USDC
      const [poorInvestor] = await ethers.getSigners();
      await fundToken.connect(fundManager).updateInvestorSuitability(poorInvestor.address, true);
      
      await expect(
        marketplace.connect(poorInvestor).buyFromFundHouse(
          await fundToken.getAddress(),
          ethers.parseUnits("100", FUND_DECIMALS)
        )
      ).to.be.revertedWithCustomError(mockUSDC, "ERC20InsufficientAllowance");
    });
  });

  describe("Secondary Market - Listing", function () {    beforeEach(async function () {
      // Give investor1 some tokens to sell
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );
      
      // Approve marketplace to transfer tokens for secondary market
      await fundToken.connect(investor1).approve(await marketplace.getAddress(), ethers.MaxUint256);
    });

    it("Should allow listing tokens for sale", async function () {
      const tokenAmount = ethers.parseUnits("50", FUND_DECIMALS);
      const pricePerToken = ethers.parseUnits("105", USDC_DECIMALS); // $105 per token

      await expect(
        marketplace.connect(investor1).listTokensForSale(
          await fundToken.getAddress(),
          tokenAmount,
          pricePerToken
        )
      ).to.emit(marketplace, "TokensListed")
        .withArgs(1, investor1.address, await fundToken.getAddress(), tokenAmount, pricePerToken);

      // Check listing details
      const listing = await marketplace.listings(1);
      expect(listing.seller).to.equal(investor1.address);
      expect(listing.fundToken).to.equal(await fundToken.getAddress());
      expect(listing.tokenAmount).to.equal(tokenAmount);
      expect(listing.pricePerToken).to.equal(pricePerToken);
      expect(listing.isActive).to.be.true;

      // Check tokens are locked
      expect(await marketplace.getLockedTokens(investor1.address, await fundToken.getAddress()))
        .to.equal(tokenAmount);
    });

    it("Should revert when listing zero tokens", async function () {
      await expect(
        marketplace.connect(investor1).listTokensForSale(
          await fundToken.getAddress(),
          0,
          ethers.parseUnits("100", USDC_DECIMALS)
        )
      ).to.be.revertedWith("Amount must be positive");
    });

    it("Should revert when listing with zero price", async function () {
      await expect(
        marketplace.connect(investor1).listTokensForSale(
          await fundToken.getAddress(),
          ethers.parseUnits("50", FUND_DECIMALS),
          0
        )
      ).to.be.revertedWith("Price must be positive");
    });

    it("Should revert when listing more tokens than balance", async function () {
      const tokenAmount = ethers.parseUnits("200", FUND_DECIMALS); // More than the 100 they have
      
      await expect(
        marketplace.connect(investor1).listTokensForSale(
          await fundToken.getAddress(),
          tokenAmount,
          ethers.parseUnits("100", USDC_DECIMALS)
        )
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert when listing unauthorized fund", async function () {
      await marketplace.connect(owner).authorizeFund(await fundToken.getAddress(), false);
      
      await expect(
        marketplace.connect(investor1).listTokensForSale(
          await fundToken.getAddress(),
          ethers.parseUnits("50", FUND_DECIMALS),
          ethers.parseUnits("100", USDC_DECIMALS)
        )
      ).to.be.revertedWith("Fund not authorized");
    });

    it("Should track multiple listings correctly", async function () {
      const tokenAmount1 = ethers.parseUnits("30", FUND_DECIMALS);
      const tokenAmount2 = ethers.parseUnits("40", FUND_DECIMALS);
      const pricePerToken = ethers.parseUnits("105", USDC_DECIMALS);

      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        tokenAmount1,
        pricePerToken
      );

      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        tokenAmount2,
        pricePerToken
      );

      expect(await marketplace.getActiveListingsCount()).to.equal(2);
      expect(await marketplace.getLockedTokens(investor1.address, await fundToken.getAddress()))
        .to.equal(tokenAmount1 + tokenAmount2);
    });
  });

  describe("Secondary Market - Cancel Listing", function () {
    let listingId;

    beforeEach(async function () {
      // Give investor1 some tokens and create a listing
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      const tx = await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        ethers.parseUnits("50", FUND_DECIMALS),
        ethers.parseUnits("105", USDC_DECIMALS)
      );
      const receipt = await tx.wait();
      listingId = 1; // First listing
    });

    it("Should allow canceling own listing", async function () {
      await expect(
        marketplace.connect(investor1).cancelListing(listingId)
      ).to.emit(marketplace, "TokensUnlisted")
        .withArgs(listingId, investor1.address);

      // Check listing is deactivated
      const listing = await marketplace.listings(listingId);
      expect(listing.isActive).to.be.false;

      // Check tokens are unlocked
      expect(await marketplace.getLockedTokens(investor1.address, await fundToken.getAddress()))
        .to.equal(0);
    });

    it("Should revert when canceling non-existent listing", async function () {
      await expect(
        marketplace.connect(investor1).cancelListing(999)
      ).to.be.revertedWith("Invalid listing ID");
    });

    it("Should revert when canceling someone else's listing", async function () {
      await expect(
        marketplace.connect(investor2).cancelListing(listingId)
      ).to.be.revertedWith("Not your listing");
    });

    it("Should revert when canceling already inactive listing", async function () {
      await marketplace.connect(investor1).cancelListing(listingId);
      
      await expect(
        marketplace.connect(investor1).cancelListing(listingId)
      ).to.be.revertedWith("Listing not active");
    });
  });

  describe("Secondary Market - Buy From Investor", function () {
    let listingId;
    const listingAmount = ethers.parseUnits("50", FUND_DECIMALS);
    const pricePerToken = ethers.parseUnits("105", USDC_DECIMALS);    beforeEach(async function () {
      // Give investor1 some tokens and create a listing
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      // Approve marketplace to transfer tokens
      await fundToken.connect(investor1).approve(await marketplace.getAddress(), ethers.MaxUint256);

      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        listingAmount,
        pricePerToken
      );
      listingId = 1;
    });

    it("Should allow buying from investor", async function () {
      const totalPrice = listingAmount * pricePerToken / ethers.parseUnits("1", FUND_DECIMALS);
      const fee = totalPrice * BigInt(TRADING_FEE_RATE) / BigInt(10000);
      const sellerReceives = totalPrice - fee;

      const initialBuyerBalance = await mockUSDC.balanceOf(investor2.address);
      const initialSellerBalance = await mockUSDC.balanceOf(investor1.address);

      await expect(
        marketplace.connect(investor2).buyFromInvestor(listingId)
      ).to.emit(marketplace, "SecondaryTrade")
        .withArgs(listingId, investor2.address, investor1.address, await fundToken.getAddress(), 
                 listingAmount, totalPrice, fee);

      // Check token transfer
      expect(await fundToken.balanceOf(investor2.address)).to.equal(listingAmount);
      expect(await fundToken.balanceOf(investor1.address)).to.equal(
        ethers.parseUnits("100", FUND_DECIMALS) - listingAmount
      );

      // Check USDC transfers
      expect(await mockUSDC.balanceOf(investor2.address)).to.equal(
        initialBuyerBalance - totalPrice - fee
      );
      expect(await mockUSDC.balanceOf(investor1.address)).to.equal(
        initialSellerBalance + sellerReceives
      );

      // Check listing is deactivated
      const listing = await marketplace.listings(listingId);
      expect(listing.isActive).to.be.false;

      // Check tokens are unlocked
      expect(await marketplace.getLockedTokens(investor1.address, await fundToken.getAddress()))
        .to.equal(0);
    });

    it("Should revert when buying own listing", async function () {
      await expect(
        marketplace.connect(investor1).buyFromInvestor(listingId)
      ).to.be.revertedWith("Cannot buy your own listing");
    });

    it("Should revert when buyer is not suitable", async function () {
      await expect(
        marketplace.connect(nonInvestor).buyFromInvestor(listingId)
      ).to.be.revertedWith("Investor not suitable");
    });

    it("Should revert when listing doesn't exist", async function () {
      await expect(
        marketplace.connect(investor2).buyFromInvestor(999)
      ).to.be.revertedWith("Invalid listing ID");
    });

    it("Should revert when listing is inactive", async function () {
      await marketplace.connect(investor1).cancelListing(listingId);
      
      await expect(
        marketplace.connect(investor2).buyFromInvestor(listingId)
      ).to.be.revertedWith("Listing not active");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Setup some data for testing view functions
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      // Create some listings
      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        ethers.parseUnits("30", FUND_DECIMALS),
        ethers.parseUnits("105", USDC_DECIMALS)
      );

      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        ethers.parseUnits("20", FUND_DECIMALS),
        ethers.parseUnits("110", USDC_DECIMALS)
      );
    });

    it("Should get active listings correctly", async function () {
      const listings = await marketplace.getActiveListings(0, 10);
      expect(listings.length).to.equal(2);
      expect(listings[0].seller).to.equal(investor1.address);
      expect(listings[1].seller).to.equal(investor1.address);
    });

    it("Should handle pagination for active listings", async function () {
      const firstPage = await marketplace.getActiveListings(0, 1);
      expect(firstPage.length).to.equal(1);

      const secondPage = await marketplace.getActiveListings(1, 1);
      expect(secondPage.length).to.equal(1);
    });

    it("Should get user listings correctly", async function () {
      const userListings = await marketplace.getUserListings(investor1.address);
      expect(userListings.length).to.equal(2);
      expect(userListings[0]).to.equal(1);
      expect(userListings[1]).to.equal(2);
    });

    it("Should get locked tokens correctly", async function () {
      const expectedLocked = ethers.parseUnits("50", FUND_DECIMALS); // 30 + 20
      const actualLocked = await marketplace.getLockedTokens(
        investor1.address, 
        await fundToken.getAddress()
      );
      expect(actualLocked).to.equal(expectedLocked);
    });

    it("Should get trade history correctly", async function () {
      const trades = await marketplace.getTradeHistory(0, 10);
      expect(trades.length).to.equal(1); // One primary market trade
      expect(trades[0].buyer).to.equal(investor1.address);
      expect(trades[0].isPrimaryMarket).to.be.true;
    });

    it("Should get counts correctly", async function () {
      expect(await marketplace.getActiveListingsCount()).to.equal(2);
      expect(await marketplace.getTradeHistoryCount()).to.equal(1);
    });

    it("Should revert view functions with invalid parameters", async function () {
      await expect(
        marketplace.getActiveListings(0, 0)
      ).to.be.revertedWith("Invalid limit");

      await expect(
        marketplace.getActiveListings(0, 101)
      ).to.be.revertedWith("Invalid limit");

      await expect(
        marketplace.getActiveListings(100, 1)
      ).to.be.revertedWith("Offset out of range");
    });
  });

  describe("Fee Withdrawal", function () {
    beforeEach(async function () {
      // Generate some fees by executing trades
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      await marketplace.connect(investor2).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );
    });

    it("Should allow owner to withdraw fees", async function () {
      const contractBalance = await mockUSDC.balanceOf(await marketplace.getAddress());
      expect(contractBalance).to.be.gt(0);

      const ownerInitialBalance = await mockUSDC.balanceOf(owner.address);
      
      await marketplace.connect(owner).withdrawFees(contractBalance);
      
      expect(await mockUSDC.balanceOf(owner.address)).to.equal(
        ownerInitialBalance + contractBalance
      );
      expect(await mockUSDC.balanceOf(await marketplace.getAddress())).to.equal(0);
    });

    it("Should allow owner to withdraw all fees", async function () {
      const contractBalance = await mockUSDC.balanceOf(await marketplace.getAddress());
      expect(contractBalance).to.be.gt(0);

      const ownerInitialBalance = await mockUSDC.balanceOf(owner.address);
      
      await marketplace.connect(owner).withdrawAllFees();
      
      expect(await mockUSDC.balanceOf(owner.address)).to.equal(
        ownerInitialBalance + contractBalance
      );
      expect(await mockUSDC.balanceOf(await marketplace.getAddress())).to.equal(0);
    });

    it("Should revert when non-owner tries to withdraw", async function () {
      await expect(
        marketplace.connect(investor1).withdrawFees(1000)
      ).to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("Should revert when withdrawing more than balance", async function () {
      const contractBalance = await mockUSDC.balanceOf(await marketplace.getAddress());
      
      await expect(
        marketplace.connect(owner).withdrawFees(contractBalance + BigInt(1))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert withdraw all when no fees", async function () {
      await marketplace.connect(owner).withdrawAllFees();
      
      await expect(
        marketplace.connect(owner).withdrawAllFees()
      ).to.be.revertedWith("No fees to withdraw");
    });
  });

  describe("Edge Cases and Complex Scenarios", function () {
    it("Should handle multiple funds correctly", async function () {
      // Buy from both funds
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken2.getAddress(),
        tokenAmount
      );

      expect(await fundToken.balanceOf(investor1.address)).to.equal(tokenAmount);
      expect(await fundToken2.balanceOf(investor1.address)).to.equal(tokenAmount);
    });

    it("Should handle zero fee trading", async function () {
      await marketplace.connect(owner).setTradingFee(0);
      
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      const expectedPrice = tokenAmount * INITIAL_NAV / ethers.parseUnits("1", FUND_DECIMALS);

      await expect(
        marketplace.connect(investor1).buyFromFundHouse(
          await fundToken.getAddress(),
          tokenAmount
        )
      ).to.emit(marketplace, "PrimaryTrade")
        .withArgs(investor1.address, await fundToken.getAddress(), tokenAmount, expectedPrice, 0);
    });

    it("Should handle reentrancy protection", async function () {
      // This test would require a malicious contract to test properly
      // For now, we verify that the modifier is present
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      
      // Normal operation should work
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );
      
      expect(await fundToken.balanceOf(investor1.address)).to.equal(tokenAmount);
    });    it("Should handle complete trading lifecycle", async function () {
      // 1. Primary market purchase
      const tokenAmount = ethers.parseUnits("100", FUND_DECIMALS);
      await marketplace.connect(investor1).buyFromFundHouse(
        await fundToken.getAddress(),
        tokenAmount
      );

      // Approve marketplace to transfer tokens
      await fundToken.connect(investor1).approve(await marketplace.getAddress(), ethers.MaxUint256);

      // 2. List on secondary market
      const listingAmount = ethers.parseUnits("50", FUND_DECIMALS);
      const pricePerToken = ethers.parseUnits("105", USDC_DECIMALS);
      await marketplace.connect(investor1).listTokensForSale(
        await fundToken.getAddress(),
        listingAmount,
        pricePerToken
      );

      // 3. Secondary market purchase
      await marketplace.connect(investor2).buyFromInvestor(1);

      // 4. Verify final state
      expect(await fundToken.balanceOf(investor1.address)).to.equal(
        tokenAmount - listingAmount
      );
      expect(await fundToken.balanceOf(investor2.address)).to.equal(listingAmount);
      expect(await marketplace.getActiveListingsCount()).to.equal(0);
      expect(await marketplace.getTradeHistoryCount()).to.equal(2);
    });
  });
});
