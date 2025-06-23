const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockUSDC", function () {
  let mockUSDC;
  let owner;
  let user1;
  let user2;
  let users;

  beforeEach(async function () {
    [owner, user1, user2, ...users] = await ethers.getSigners();
    
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
  });

  describe("Deployment", function () {    it("Should set the correct name and symbol", async function () {
      expect(await mockUSDC.name()).to.equal("Mock USD Coin");
      expect(await mockUSDC.symbol()).to.equal("MockUSDC");
    });

    it("Should set correct decimals", async function () {
      expect(await mockUSDC.decimals()).to.equal(6);
    });

    it("Should set the deployer as owner", async function () {
      expect(await mockUSDC.owner()).to.equal(owner.address);
    });    it("Should mint initial supply to deployer", async function () {
      const expectedInitialSupply = ethers.parseUnits("100000000", 6); // 100M tokens
      expect(await mockUSDC.totalSupply()).to.equal(expectedInitialSupply);
      expect(await mockUSDC.balanceOf(owner.address)).to.equal(expectedInitialSupply);
    });
  });
  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const amount = ethers.parseUnits("1000", 6); // 1000 USDC with 6 decimals
      
      await expect(mockUSDC.mint(user1.address, amount, "Test minting"))
        .to.emit(mockUSDC, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, amount)
        .and.to.emit(mockUSDC, "TokensMinted")
        .withArgs(user1.address, amount, "Test minting");

      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const amount = ethers.parseUnits("1000", 6);
      
      await expect(mockUSDC.connect(user1).mint(user2.address, amount, "Test minting"))
        .to.be.revertedWithCustomError(mockUSDC, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should not allow minting to zero address", async function () {
      const amount = ethers.parseUnits("1000", 6);
      
      await expect(mockUSDC.mint(ethers.ZeroAddress, amount, "Test minting"))
        .to.be.revertedWith("MockUSDC: mint to zero address");
    });
  });
  describe("Batch Minting", function () {
    it("Should allow owner to batch mint tokens", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6)
      ];

      await mockUSDC.batchMint(recipients, amounts, "Test batch minting");

      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amounts[0]);
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(amounts[1]);
    });

    it("Should not allow batch mint with mismatched arrays", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [ethers.parseUnits("1000", 6)]; // Only one amount

      await expect(mockUSDC.batchMint(recipients, amounts, "Test batch minting"))
        .to.be.revertedWith("MockUSDC: arrays length mismatch");
    });

    it("Should not allow non-owner to batch mint", async function () {
      const recipients = [user1.address];
      const amounts = [ethers.parseUnits("1000", 6)];

      await expect(mockUSDC.connect(user1).batchMint(recipients, amounts, "Test batch minting"))
        .to.be.revertedWithCustomError(mockUSDC, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });
  });
  describe("Burning", function () {
    beforeEach(async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.mint(user1.address, amount, "Setup for burning tests");
    });

    it("Should allow owner to burn tokens from any account", async function () {
      const burnAmount = ethers.parseUnits("500", 6);
      const initialBalance = await mockUSDC.balanceOf(user1.address);
      
      await expect(mockUSDC.burn(user1.address, burnAmount, "Test burning"))
        .to.emit(mockUSDC, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, burnAmount)
        .and.to.emit(mockUSDC, "TokensBurned")
        .withArgs(user1.address, burnAmount, "Test burning");

      expect(await mockUSDC.balanceOf(user1.address)).to.equal(initialBalance - burnAmount);
    });

    it("Should not allow burning more than balance", async function () {
      const burnAmount = ethers.parseUnits("2000", 6); // More than balance
      
      await expect(mockUSDC.burn(user1.address, burnAmount, "Test burning"))
        .to.be.revertedWith("MockUSDC: insufficient balance to burn");
    });

    it("Should not allow non-owner to burn tokens", async function () {
      const burnAmount = ethers.parseUnits("500", 6);
      
      await expect(mockUSDC.connect(user1).burn(user1.address, burnAmount, "Test burning"))
        .to.be.revertedWithCustomError(mockUSDC, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });
  });
  describe("Standard ERC20 Functions", function () {
    beforeEach(async function () {
      const amount = ethers.parseUnits("1000", 6);
      await mockUSDC.mint(user1.address, amount, "Setup for ERC20 tests");
    });

    it("Should allow transfers between accounts", async function () {
      const transferAmount = ethers.parseUnits("100", 6);
      
      await expect(mockUSDC.connect(user1).transfer(user2.address, transferAmount))
        .to.emit(mockUSDC, "Transfer")
        .withArgs(user1.address, user2.address, transferAmount);

      expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("900", 6));
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should allow approvals and transferFrom", async function () {
      const approveAmount = ethers.parseUnits("200", 6);
      const transferAmount = ethers.parseUnits("100", 6);

      await mockUSDC.connect(user1).approve(user2.address, approveAmount);
      expect(await mockUSDC.allowance(user1.address, user2.address)).to.equal(approveAmount);

      await mockUSDC.connect(user2).transferFrom(user1.address, user2.address, transferAmount);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("900", 6));
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await mockUSDC.allowance(user1.address, user2.address)).to.equal(approveAmount - transferAmount);
    });

    it("Should return correct readable balance", async function () {
      const balance = await mockUSDC.getReadableBalance(user1.address);
      expect(balance).to.equal("1000.000000");
    });
  });
});
