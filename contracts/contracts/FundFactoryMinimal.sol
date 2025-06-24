// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./FundToken.sol";

/**
 * @title FundFactory - Minimal Version
 * @notice Factory for creating FundToken instances
 */
contract FundFactory is Ownable, ReentrancyGuard {
    
    struct FundHouse {
        string name;
        address manager;
        bool isApproved;
        bool isActive;
        uint256 totalFundsCreated;
    }
    
    struct DeployedFund {
        address fundAddress;
        string fundName;
        address fundHouse;
        address manager;
        bool isActive;
    }
    
    mapping(address => FundHouse) public fundHouses;
    address[] public approvedFundHouses;
    address[] public deployedFunds;
    mapping(address => DeployedFund) public fundRegistry;
    mapping(address => address[]) public fundHouseToFunds;
    mapping(string => address) public fundNameToAddress;
    mapping(address => bool) public authorizedDeployers;
    
    uint256 public constant MAX_FUNDS_PER_HOUSE = 50;
    bool public paused;
    
    event FundHouseRegistered(address indexed fundHouse, string name);
    event FundHouseApproved(address indexed fundHouse, bool approved);
    event FundDeployed(address indexed fundAddress, address indexed fundHouse, string fundName);
    event AuthorizedDeployerAdded(address indexed deployer);
    
    constructor(address initialOwner) Ownable(initialOwner) {
        authorizedDeployers[initialOwner] = true;
    }
    
    modifier onlyApprovedFundHouse() {
        require(fundHouses[msg.sender].isApproved && fundHouses[msg.sender].isActive, "Not approved");
        _;
    }
    
    modifier onlyAuthorizedDeployer() {
        require(authorizedDeployers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }
    
    function registerFundHouse(string calldata name, address manager) external {
        require(bytes(name).length > 0 && manager != address(0), "Invalid params");
        require(!fundHouses[msg.sender].isApproved, "Already registered");
        
        fundHouses[msg.sender] = FundHouse({
            name: name,
            manager: manager,
            isApproved: false,
            isActive: true,
            totalFundsCreated: 0
        });
        
        emit FundHouseRegistered(msg.sender, name);
    }
    
    function approveFundHouse(address fundHouse, bool approved) external onlyOwner {
        fundHouses[fundHouse].isApproved = approved;
        if (approved) {
            approvedFundHouses.push(fundHouse);
        }
        emit FundHouseApproved(fundHouse, approved);
    }
    
    function deployFund(
        string calldata tokenName,
        string calldata tokenSymbol,
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external onlyApprovedFundHouse nonReentrant whenNotPaused returns (address) {
        require(bytes(tokenName).length > 0 && bytes(fundInfo.fundName).length > 0, "Invalid params");
        require(fundHouses[msg.sender].totalFundsCreated < MAX_FUNDS_PER_HOUSE, "Max exceeded");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "Name exists");
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        address fundAddress = address(newFund);
        
        fundRegistry[fundAddress] = DeployedFund({
            fundAddress: fundAddress,
            fundName: fundInfo.fundName,
            fundHouse: msg.sender,
            manager: fundInfo.manager,
            isActive: true
        });
        
        deployedFunds.push(fundAddress);
        fundHouseToFunds[msg.sender].push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        fundHouses[msg.sender].totalFundsCreated++;
        
        emit FundDeployed(fundAddress, msg.sender, fundInfo.fundName);
        return fundAddress;
    }
    
    function deployFundForHouse(
        address fundHouse,
        string calldata tokenName,
        string calldata tokenSymbol,
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external onlyAuthorizedDeployer nonReentrant whenNotPaused returns (address) {
        require(fundHouses[fundHouse].isApproved && fundHouses[fundHouse].isActive, "Invalid house");
        require(bytes(tokenName).length > 0 && bytes(fundInfo.fundName).length > 0, "Invalid params");
        require(fundHouses[fundHouse].totalFundsCreated < MAX_FUNDS_PER_HOUSE, "Max exceeded");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "Name exists");
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        address fundAddress = address(newFund);
        
        fundRegistry[fundAddress] = DeployedFund({
            fundAddress: fundAddress,
            fundName: fundInfo.fundName,
            fundHouse: fundHouse,
            manager: fundInfo.manager,
            isActive: true
        });
        
        deployedFunds.push(fundAddress);
        fundHouseToFunds[fundHouse].push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        fundHouses[fundHouse].totalFundsCreated++;
        
        emit FundDeployed(fundAddress, fundHouse, fundInfo.fundName);
        return fundAddress;
    }
    
    function addAuthorizedDeployer(address deployer) external onlyOwner {
        require(deployer != address(0) && !authorizedDeployers[deployer], "Invalid");
        authorizedDeployers[deployer] = true;
        emit AuthorizedDeployerAdded(deployer);
    }
    
    function removeAuthorizedDeployer(address deployer) external onlyOwner {
        require(authorizedDeployers[deployer] && deployer != owner(), "Invalid");
        authorizedDeployers[deployer] = false;
    }
    
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
    
    function toggleFundHouseStatus(address fundHouse) external onlyOwner {
        fundHouses[fundHouse].isActive = !fundHouses[fundHouse].isActive;
    }
    
    // View functions
    function getDeployedFundsCount() external view returns (uint256) {
        return deployedFunds.length;
    }
    
    function getApprovedFundHousesCount() external view returns (uint256) {
        return approvedFundHouses.length;
    }
    
    function getFundsByHouse(address fundHouse) external view returns (address[] memory) {
        return fundHouseToFunds[fundHouse];
    }
    
    function isFundHouseValid(address fundHouse) external view returns (bool) {
        return fundHouses[fundHouse].isApproved && fundHouses[fundHouse].isActive;
    }
    
    function getFundByName(string calldata fundName) external view returns (address fundAddress, DeployedFund memory fundInfo) {
        fundAddress = fundNameToAddress[fundName];
        if (fundAddress != address(0)) {
            fundInfo = fundRegistry[fundAddress];
        }
    }
    
    function getDeployedFundsPaginated(uint256 offset, uint256 limit) external view returns (address[] memory funds, uint256 total) {
        total = deployedFunds.length;
        if (offset >= total) return (new address[](0), total);
        
        uint256 end = offset + limit > total ? total : offset + limit;
        funds = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            funds[i - offset] = deployedFunds[i];
        }
    }
    
    function getApprovedFundHousesPaginated(uint256 offset, uint256 limit) external view returns (address[] memory houses, uint256 total) {
        total = approvedFundHouses.length;
        if (offset >= total) return (new address[](0), total);
        
        uint256 end = offset + limit > total ? total : offset + limit;
        houses = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            houses[i - offset] = approvedFundHouses[i];
        }
    }
}
