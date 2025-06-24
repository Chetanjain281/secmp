require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1, // Minimize contract size for deployment
      },
      viaIR: true, // Enable intermediate representation for complex contracts
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
      accounts: {
        count: 20, // Generate 20 accounts for testing
        accountsBalance: "10000000000000000000000", // 10,000 ETH per account
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
  },
};
