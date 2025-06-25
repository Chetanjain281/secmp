const { ethers } = require("hardhat");

async function main() {
  console.log("Starting simple test...");
  
  try {
    // Get signers
    const [owner] = await ethers.getSigners();
    console.log("Owner address:", owner.address);
    
    // Try to deploy MockUSDC
    console.log("Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    console.log("MockUSDC deployed to:", await mockUSDC.getAddress());
    
    // Test basic functionality
    const name = await mockUSDC.name();
    const symbol = await mockUSDC.symbol();
    const decimals = await mockUSDC.decimals();
    
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals);
    
    console.log("MockUSDC test passed!");
    
    // Try to deploy FundFactory
    console.log("\nDeploying FundFactory...");
    const FundFactory = await ethers.getContractFactory("FundFactory");
    const fundFactory = await FundFactory.deploy(owner.address);
    await fundFactory.waitForDeployment();
    console.log("FundFactory deployed to:", await fundFactory.getAddress());
    
    // Test basic functionality
    const factoryOwner = await fundFactory.owner();
    const fundCount = await fundFactory.getFundCount();
    const isPaused = await fundFactory.paused();
    
    console.log("Factory Owner:", factoryOwner);
    console.log("Fund Count:", fundCount.toString());
    console.log("Is Paused:", isPaused);
    
    console.log("FundFactory test passed!");
    
  } catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
