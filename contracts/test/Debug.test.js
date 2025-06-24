const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Debug FundToken", function () {
  it("Should show available functions", async function () {
    const [owner, manager] = await ethers.getSigners();
    
    const FundInfo = {
      fundName: "Test Fund",
      fundType: "test",
      description: "Test",
      manager: manager.address,
      minimumInvestment: ethers.parseUnits("1000", 6),
      currentNAV: ethers.parseUnits("100", 6),
      totalAssetValue: ethers.parseUnits("100000", 6),
      isActive: true,
      createdAt: 0
    };

    const SuitabilityCriteria = {
      minIncomeLevel: "1Cr+",
      minExperience: "beginner",
      allowedRiskTolerance: ["conservative"],
      allowedGeography: ["US"],
      isActive: true
    };

    const FundToken = await ethers.getContractFactory("FundToken");
    const fundToken = await FundToken.deploy("Test Token", "TEST", FundInfo, SuitabilityCriteria);
    await fundToken.waitForDeployment();    console.log("Available functions:");
    console.log(Object.keys(fundToken.interface.fragments));
    
    // Check if mint function exists
    console.log("Mint function:", fundToken.interface.getFunction("mint"));
    
    // Try to call mint to see what happens
    try {
      await fundToken.mint(owner.address, 1000);
      console.log("Mint call succeeded");
    } catch (error) {
      console.log("Mint call failed:", error.message);
    }
  });
});
