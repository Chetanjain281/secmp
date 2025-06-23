const { ethers } = require("hardhat");
const deployMockUSDC = require("./deploy-mockusdc");

async function main() {
  console.log("Starting complete deployment process...\n");
  
  const [deployer, fundManager, investor1, investor2] = await ethers.getSigners();
  console.log("Available accounts:");
  console.log("Deployer:", deployer.address);
  console.log("Fund Manager:", fundManager.address);
  console.log("Investor 1:", investor1.address);
  console.log("Investor 2:", investor2.address);
  console.log();

  // Deploy MockUSDC
  console.log("=== Step 1: Deploying MockUSDC ===");
  const { mockUSDC } = await deployMockUSDC();
  const mockUSDCAddress = await mockUSDC.getAddress();

  // Deploy FundToken
  console.log("\n=== Step 2: Deploying FundToken ===");
  const FundToken = await ethers.getContractFactory("FundToken");
  
  // Fund info structure matching the current contract
  const fundInfo = {
    fundName: "Comprehensive Alpha Growth Fund",
    fundType: "private_equity",
    description: "A comprehensive multi-strategy private equity fund for institutional and high-net-worth investors",
    manager: fundManager.address,
    minimumInvestment: ethers.parseUnits("100000", 6), // 100k USDC minimum
    currentNAV: ethers.parseUnits("100", 6), // $100 per token initially
    totalAssetValue: ethers.parseUnits("100000000", 6), // $100M total assets under management
    isActive: true,
    createdAt: 0 // Will be set by contract
  };

  // Suitability criteria structure
  const suitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate", 
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "SG", "US", "AE", "UK"],
    isActive: true
  };

  const fundToken = await FundToken.deploy(
    "Comprehensive Alpha Growth Fund Token", // Token name
    "CAGFT", // Token symbol
    fundInfo,
    suitabilityCriteria
  );
  
  await fundToken.waitForDeployment();
  const fundTokenAddress = await fundToken.getAddress();
  console.log("FundToken deployed to:", fundTokenAddress);

  // Setup initial state for testing
  console.log("\n=== Step 3: Initial Setup ===");
  
  // Mint USDC to investors for testing
  const investor1Amount = ethers.parseUnits("1000000", 6); // 1M USDC
  const investor2Amount = ethers.parseUnits("500000", 6);  // 500K USDC
    await mockUSDC.mint(investor1.address, investor1Amount, "Test investor setup");
  await mockUSDC.mint(investor2.address, investor2Amount, "Test investor setup");
  console.log("Minted USDC to investors for testing");

  // Verify deployments
  console.log("\n=== Step 4: Verification ===");
  const deployedFundInfo = await fundToken.fundInfo();
  console.log("Fund Name:", deployedFundInfo.fundName);
  console.log("Fund Type:", deployedFundInfo.fundType);
  console.log("Manager:", deployedFundInfo.manager);
  console.log("Min Investment:", ethers.formatUnits(deployedFundInfo.minimumInvestment, 6), "USDC");
  console.log("Initial NAV:", ethers.formatUnits(deployedFundInfo.currentNAV, 6), "USD");
  console.log("Is Active:", deployedFundInfo.isActive);

  // Check suitability for test investors (example check)
  const investor1Suitable = await fundToken.checkSuitability("1Cr+", "expert", "aggressive", "IN");
  const investor2Suitable = await fundToken.checkSuitability("5Cr+", "intermediate", "moderate", "US");
  console.log("Investor1 suitability (1Cr+/expert/aggressive/IN):", investor1Suitable);
  console.log("Investor2 suitability (5Cr+/intermediate/moderate/US):", investor2Suitable);

  // Final deployment summary
  const deploymentSummary = {
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber(),
    contracts: {
      MockUSDC: {
        address: mockUSDCAddress,
        name: "Mock USD Coin",
        symbol: "MUSDC",
        decimals: 6,
        totalSupply: ethers.formatUnits(await mockUSDC.totalSupply(), 6) + " MUSDC"
      },
      FundToken: {
        address: fundTokenAddress,
        name: deployedFundInfo.fundName,
        symbol: "CAGFT",
        manager: deployedFundInfo.manager,
        fundType: deployedFundInfo.fundType,
        minimumInvestment: ethers.formatUnits(deployedFundInfo.minimumInvestment, 6) + " USDC",
        initialNAV: ethers.formatUnits(deployedFundInfo.currentNAV, 6) + " USD",
        totalAssetValue: ethers.formatUnits(deployedFundInfo.totalAssetValue, 6) + " USD"
      }
    },
    testAccounts: {
      investor1: {
        address: investor1.address,
        usdcBalance: ethers.formatUnits(investor1Amount, 6) + " USDC",
        suitabilityExample: investor1Suitable
      },
      investor2: {
        address: investor2.address,
        usdcBalance: ethers.formatUnits(investor2Amount, 6) + " USDC",
        suitabilityExample: investor2Suitable
      }
    }
  };

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log(JSON.stringify(deploymentSummary, null, 2));
  
  // Save deployment info to file for reference
  const fs = require('fs');
  const path = require('path');
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `deployment-${Date.now()}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentSummary, null, 2));
  console.log("\nDeployment info saved to:", deploymentFile);
  return deploymentSummary;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
