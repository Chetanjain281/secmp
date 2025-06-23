const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying MockUSDC...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();

  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log("MockUSDC deployed to:", mockUSDCAddress);
  // Mint some initial tokens for testing
  const mintAmount = ethers.parseUnits("10000000", 6); // 10 million USDC
  await mockUSDC.mint(deployer.address, mintAmount, "Initial deployment mint");
  console.log("Minted", ethers.formatUnits(mintAmount, 6), "MUSDC to deployer");

  // Save deployment info
  const deploymentInfo = {
    MockUSDC: {
      address: mockUSDCAddress,
      deployer: deployer.address,
      deploymentTime: new Date().toISOString(),
      initialMint: ethers.formatUnits(mintAmount, 6)
    }
  };

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  return { mockUSDC, deploymentInfo };
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
