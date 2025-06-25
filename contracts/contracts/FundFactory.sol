// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./FundToken.sol";

/**
 * @title FundFactory
 * @dev Factory for creating and managing FundToken instances with full administrative controls
 */
contract FundFactory is Ownable, Pausable {
      struct FundHouseInfo {
        string name;
        address manager;
        bool isActive;
        bool isApproved;
        uint256 totalFundsCreated;
        uint256 registrationDate;
    }
    
    mapping(address => FundHouseInfo) public fundHouses;
    mapping(address => bool) public authorizedDeployers;
    address[] public deployedFunds;
    address[] public registeredFundHousesList;
    mapping(string => address) public fundNameToAddress;
    
    event FundHouseRegistered(address indexed fundHouse, string name, address manager);
    event FundHouseApproved(address indexed fundHouse, bool approved);
    event FundHouseStatusToggled(address indexed fundHouse, bool isActive);
    event FundCreated(address indexed fundAddress, address indexed fundHouse, string fundName);
    event AuthorizedDeployerAdded(address indexed deployer);
    event AuthorizedDeployerRemoved(address indexed deployer);
    
    constructor(address initialOwner) Ownable(initialOwner) {
        // Owner is automatically an authorized deployer
        authorizedDeployers[initialOwner] = true;
    }
    
    modifier onlyAuthorizedDeployer() {
        require(authorizedDeployers[msg.sender], "Not authorized deployer");
        _;
    }
    
    modifier onlyRegisteredFundHouse() {
        require(bytes(fundHouses[msg.sender].name).length > 0, "Not registered fund house");
        require(fundHouses[msg.sender].isApproved, "Fund house not approved");
        require(fundHouses[msg.sender].isActive, "Fund house not active");
        _;
    }
      // Fund House Management
    function registerFundHouse(string calldata name, address manager) external {
        require(bytes(name).length > 0, "Invalid params");
        require(manager != address(0), "Invalid params");
        require(bytes(fundHouses[msg.sender].name).length == 0, "Already registered");
        
        fundHouses[msg.sender] = FundHouseInfo({
            name: name,
            manager: manager,
            isActive: true,
            isApproved: false,
            totalFundsCreated: 0,
            registrationDate: block.timestamp
        });
        
        registeredFundHousesList.push(msg.sender);
        emit FundHouseRegistered(msg.sender, name, manager);
    }
    
    function approveFundHouse(address fundHouse, bool approved) external onlyOwner {
        require(bytes(fundHouses[fundHouse].name).length > 0, "Fund house not registered");
        fundHouses[fundHouse].isApproved = approved;
        emit FundHouseApproved(fundHouse, approved);
    }
    
    function toggleFundHouseStatus(address fundHouse) external onlyOwner {
        require(bytes(fundHouses[fundHouse].name).length > 0, "Fund house not registered");
        fundHouses[fundHouse].isActive = !fundHouses[fundHouse].isActive;
        emit FundHouseStatusToggled(fundHouse, fundHouses[fundHouse].isActive);
    }
      // Fund Creation
    function createFund(
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external onlyRegisteredFundHouse whenNotPaused returns (address) {
        require(bytes(fundInfo.fundName).length > 0, "Invalid fund name");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "Fund name already exists");
        
        // Create fund token
        string memory tokenName = string(abi.encodePacked(fundInfo.fundName, " Token"));
        string memory tokenSymbol = _generateSymbol(fundInfo.fundName, fundInfo.fundType);
          FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        address fundAddress = address(newFund);
        
        // Transfer ownership to the fund manager
        newFund.transferOwnership(fundInfo.manager);
        
        deployedFunds.push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        
        // Increment fund count for the fund house
        fundHouses[msg.sender].totalFundsCreated++;
        
        emit FundCreated(fundAddress, msg.sender, fundInfo.fundName);
        return fundAddress;
    }
    
    function deployFund(
        string calldata tokenName,
        string calldata tokenSymbol,
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external onlyAuthorizedDeployer whenNotPaused returns (address) {
        require(bytes(fundInfo.fundName).length > 0, "Invalid params");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "Name exists");
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        address fundAddress = address(newFund);
        
        deployedFunds.push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        
        emit FundCreated(fundAddress, msg.sender, fundInfo.fundName);
        return fundAddress;
    }
    
    // Authorized Deployer Management
    function addAuthorizedDeployer(address deployer) external onlyOwner {
        require(deployer != address(0), "Invalid deployer");
        require(!authorizedDeployers[deployer], "Already authorized");
        authorizedDeployers[deployer] = true;
        emit AuthorizedDeployerAdded(deployer);
    }
    
    function removeAuthorizedDeployer(address deployer) external onlyOwner {
        require(deployer != owner(), "Invalid");
        require(authorizedDeployers[deployer], "Not authorized");
        authorizedDeployers[deployer] = false;
        emit AuthorizedDeployerRemoved(deployer);
    }
    
    // Administrative Functions
    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            _pause();
        } else {
            _unpause();
        }
    }
      // View Functions
    function getFundCount() external view returns (uint256) {
        return deployedFunds.length;
    }
    
    function getDeployedFundsCount() external view returns (uint256) {
        return deployedFunds.length;
    }
    
    function getApprovedFundHousesCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < registeredFundHousesList.length; i++) {
            if (fundHouses[registeredFundHousesList[i]].isApproved) {
                count++;
            }
        }
        return count;
    }
    
    function getFundByName(string calldata name) external view returns (address) {
        return fundNameToAddress[name];
    }
    
    function getFundHouseCount() external view returns (uint256) {
        return registeredFundHousesList.length;
    }
    
    function getFundHouseAt(uint256 index) external view returns (address) {
        require(index < registeredFundHousesList.length, "Index out of bounds");
        return registeredFundHousesList[index];
    }
    
    function isFundHouseRegistered(address fundHouse) external view returns (bool) {
        return bytes(fundHouses[fundHouse].name).length > 0;
    }
    
    function isFundHouseApproved(address fundHouse) external view returns (bool) {
        return fundHouses[fundHouse].isApproved;
    }
    
    function isAuthorizedDeployer(address deployer) external view returns (bool) {
        return authorizedDeployers[deployer];
    }
    
    // Internal helper functions
    function _generateSymbol(string memory fundName, string memory fundType) internal pure returns (string memory) {
        // Take first 3 chars of fund name and first char of fund type
        bytes memory nameBytes = bytes(fundName);
        bytes memory typeBytes = bytes(fundType);
        
        if (nameBytes.length >= 3 && typeBytes.length >= 1) {
            return string(abi.encodePacked(
                nameBytes[0],
                nameBytes[1], 
                nameBytes[2],
                typeBytes[0]
            ));
        }
        return "FUND";
    }
}
