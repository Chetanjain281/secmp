const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying FundToken...");
  
  const [deployer, fundManager] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Deploy FundToken with current constructor format
  const FundToken = await ethers.getContractFactory("FundToken");
  
  // Fund info structure matching the current contract
  const fundInfo = {
    fundName: "Alpha Growth Private Equity Fund",
    fundType: "private_equity",
    description: "A premium private equity fund focusing on growth-stage companies in emerging markets",
    manager: fundManager.address,
    minimumInvestment: ethers.parseUnits("100000", 6), // 100k USDC minimum
    currentNAV: ethers.parseUnits("100", 6), // $100 per token initially
    totalAssetValue: ethers.parseUnits("50000000", 6), // $50M total assets under management
    isActive: true,
    createdAt: 0 // Will be set by contract
  };

  // Suitability criteria structure
  const suitabilityCriteria = {
    minIncomeLevel: "1Cr+",
    minExperience: "intermediate", 
    allowedRiskTolerance: ["moderate", "aggressive"],
    allowedGeography: ["IN", "SG", "US", "AE"],
    isActive: true
  };

  console.log("Deploying with fund info:", {
    name: fundInfo.fundName,
    type: fundInfo.fundType,
    manager: fundInfo.manager,
    minInvestment: ethers.formatUnits(fundInfo.minimumInvestment, 6) + " USDC",
    initialNAV: ethers.formatUnits(fundInfo.currentNAV, 6) + " USD"
  });

  const fundToken = await FundToken.deploy(
    "Alpha Growth Fund Token", // Token name
    "AGFT", // Token symbol
    fundInfo,
    suitabilityCriteria
  );
  
  await fundToken.waitForDeployment();
  const fundTokenAddress = await fundToken.getAddress();
  console.log("FundToken deployed to:", fundTokenAddress);

  // Verify deployment
  const deployedFundInfo = await fundToken.fundInfo();
  console.log("\nDeployed Fund Details:");
  console.log("- Name:", deployedFundInfo.fundName);
  console.log("- Type:", deployedFundInfo.fundType);
  console.log("- Manager:", deployedFundInfo.manager);
  console.log("- Min Investment:", ethers.formatUnits(deployedFundInfo.minimumInvestment, 6), "USDC");
  console.log("- Current NAV:", ethers.formatUnits(deployedFundInfo.currentNAV, 6), "USD");
  console.log("- Is Active:", deployedFundInfo.isActive);

  // Check NAV history
  const navHistoryCount = await fundToken.getNAVHistoryCount();
  console.log("- NAV History Entries:", navHistoryCount.toString());

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    FundToken: {
      address: fundTokenAddress,
      deployer: deployer.address,
      fundManager: fundManager.address,
      deploymentTime: new Date().toISOString(),  
      blockNumber: await ethers.provider.getBlockNumber(),
      fundDetails: {
        name: fundInfo.fundName,
        symbol: "AGFT",
        type: fundInfo.fundType,
        manager: fundInfo.manager,
        minimumInvestment: ethers.formatUnits(fundInfo.minimumInvestment, 6) + " USDC",
        initialNAV: ethers.formatUnits(fundInfo.currentNAV, 6) + " USD",
        totalAssetValue: ethers.formatUnits(fundInfo.totalAssetValue, 6) + " USD"
      },
      suitabilityCriteria: {
        minIncomeLevel: suitabilityCriteria.minIncomeLevel,
        minExperience: suitabilityCriteria.minExperience,
        allowedRiskTolerance: suitabilityCriteria.allowedRiskTolerance,
        allowedGeography: suitabilityCriteria.allowedGeography
      }
    }
  };

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  return { fundToken, deploymentInfo };
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
