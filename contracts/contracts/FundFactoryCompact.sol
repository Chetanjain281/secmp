// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./FundToken.sol";

/**
 * @title FundFactory
 * @notice Factory contract for creating and managing FundToken instances
 * @dev Optimized version with core functionality only
 */
contract FundFactory is Ownable, ReentrancyGuard, Pausable {
    
    // ==================== STRUCTS ====================
    
    struct FundHouse {
        string name;
        string registrationNumber;
        address manager;
        bool isApproved;
        bool isActive;
        uint256 createdAt;
        uint256 totalFundsCreated;
    }
    
    struct DeployedFund {
        address fundAddress;
        string fundName;
        string fundType;
        address fundHouse;
        address manager;
        uint256 deployedAt;
        bool isActive;
    }
    
    // ==================== STATE VARIABLES ====================
    
    mapping(address => FundHouse) public fundHouses;
    address[] public approvedFundHouses;
    address[] public deployedFunds;
    mapping(address => DeployedFund) public fundRegistry;
    mapping(address => address[]) public fundHouseToFunds;
    mapping(string => address) public fundNameToAddress;
    mapping(address => bool) public authorizedDeployers;
    
    uint256 public constant MAX_FUNDS_PER_HOUSE = 50;
    uint256 public fundCreationFee = 0 ether;
    
    // ==================== EVENTS ====================
    
    event FundHouseRegistered(address indexed fundHouse, string name, string registrationNumber, address manager);
    event FundHouseApproved(address indexed fundHouse, bool approved);
    event FundHouseStatusChanged(address indexed fundHouse, bool active);
    event FundDeployed(address indexed fundAddress, address indexed fundHouse, string fundName, string fundType, address manager);
    event FundStatusChanged(address indexed fundAddress, bool active);
    event AuthorizedDeployerAdded(address indexed deployer);
    event AuthorizedDeployerRemoved(address indexed deployer);
    event FundCreationFeeUpdated(uint256 oldFee, uint256 newFee);
    
    // ==================== CONSTRUCTOR ====================
    
    constructor(address initialOwner) Ownable(initialOwner) {
        authorizedDeployers[initialOwner] = true;
        emit AuthorizedDeployerAdded(initialOwner);
    }
    
    // ==================== MODIFIERS ====================
    
    modifier onlyApprovedFundHouse() {
        require(fundHouses[msg.sender].isApproved && fundHouses[msg.sender].isActive, "FundFactory: not approved/active fund house");
        _;
    }
    
    modifier onlyAuthorizedDeployer() {
        require(authorizedDeployers[msg.sender] || msg.sender == owner(), "FundFactory: not authorized deployer");
        _;
    }
    
    // ==================== FUND HOUSE MANAGEMENT ====================
    
    function registerFundHouse(string calldata name, string calldata registrationNumber, address manager) external nonReentrant {
        require(bytes(name).length > 0 && bytes(registrationNumber).length > 0, "FundFactory: invalid parameters");
        require(manager != address(0), "FundFactory: invalid manager address");
        require(!fundHouses[msg.sender].isApproved, "FundFactory: already registered");
        
        fundHouses[msg.sender] = FundHouse({
            name: name,
            registrationNumber: registrationNumber,
            manager: manager,
            isApproved: false,
            isActive: true,
            createdAt: block.timestamp,
            totalFundsCreated: 0
        });
        
        emit FundHouseRegistered(msg.sender, name, registrationNumber, manager);
    }
    
    function approveFundHouse(address fundHouse, bool approved) external onlyOwner {
        require(fundHouses[fundHouse].createdAt > 0, "FundFactory: fund house not registered");
        
        bool wasApproved = fundHouses[fundHouse].isApproved;
        fundHouses[fundHouse].isApproved = approved;
        
        if (approved && !wasApproved) {
            approvedFundHouses.push(fundHouse);
        } else if (!approved && wasApproved) {
            _removeFromApprovedList(fundHouse);
        }
        
        emit FundHouseApproved(fundHouse, approved);
    }
    
    function toggleFundHouseStatus(address fundHouse) external onlyOwner {
        require(fundHouses[fundHouse].createdAt > 0, "FundFactory: fund house not registered");
        fundHouses[fundHouse].isActive = !fundHouses[fundHouse].isActive;
        emit FundHouseStatusChanged(fundHouse, fundHouses[fundHouse].isActive);
    }
    
    // ==================== FUND DEPLOYMENT ====================
    
    function deployFund(
        string calldata tokenName,
        string calldata tokenSymbol,
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external payable onlyApprovedFundHouse nonReentrant whenNotPaused returns (address fundAddress) {
        require(msg.value >= fundCreationFee, "FundFactory: insufficient fee");
        require(_validateFundParams(tokenName, tokenSymbol, fundInfo), "FundFactory: invalid parameters");
        require(fundHouses[msg.sender].totalFundsCreated < MAX_FUNDS_PER_HOUSE, "FundFactory: max funds exceeded");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "FundFactory: fund name exists");
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        fundAddress = address(newFund);
        
        _registerFund(fundAddress, fundInfo, msg.sender);
        
        emit FundDeployed(fundAddress, msg.sender, fundInfo.fundName, fundInfo.fundType, fundInfo.manager);
        return fundAddress;
    }
    
    function deployFundForHouse(
        address fundHouse,
        string calldata tokenName,
        string calldata tokenSymbol,
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external onlyAuthorizedDeployer nonReentrant whenNotPaused returns (address fundAddress) {
        require(fundHouses[fundHouse].isApproved && fundHouses[fundHouse].isActive, "FundFactory: invalid fund house");
        require(_validateFundParams(tokenName, tokenSymbol, fundInfo), "FundFactory: invalid parameters");
        require(fundHouses[fundHouse].totalFundsCreated < MAX_FUNDS_PER_HOUSE, "FundFactory: max funds exceeded");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "FundFactory: fund name exists");
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        fundAddress = address(newFund);
        
        _registerFund(fundAddress, fundInfo, fundHouse);
        
        emit FundDeployed(fundAddress, fundHouse, fundInfo.fundName, fundInfo.fundType, fundInfo.manager);
        return fundAddress;
    }
    
    // ==================== ACCESS CONTROL ====================
    
    function addAuthorizedDeployer(address deployer) external onlyOwner {
        require(deployer != address(0) && !authorizedDeployers[deployer], "FundFactory: invalid or already authorized");
        authorizedDeployers[deployer] = true;
        emit AuthorizedDeployerAdded(deployer);
    }
    
    function removeAuthorizedDeployer(address deployer) external onlyOwner {
        require(authorizedDeployers[deployer] && deployer != owner(), "FundFactory: not authorized or is owner");
        authorizedDeployers[deployer] = false;
        emit AuthorizedDeployerRemoved(deployer);
    }
    
    function updateFundCreationFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = fundCreationFee;
        fundCreationFee = newFee;
        emit FundCreationFeeUpdated(oldFee, newFee);
    }
    
    // ==================== VIEW FUNCTIONS ====================
    
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
    
    // ==================== ADMIN FUNCTIONS ====================
    
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    
    function toggleFundStatus(address fundAddress) external onlyOwner {
        require(fundRegistry[fundAddress].fundAddress != address(0), "FundFactory: fund not found");
        fundRegistry[fundAddress].isActive = !fundRegistry[fundAddress].isActive;
        emit FundStatusChanged(fundAddress, fundRegistry[fundAddress].isActive);
    }
    
    function withdrawFees(address payable to) external onlyOwner {
        require(to != address(0), "FundFactory: invalid recipient");
        uint256 balance = address(this).balance;
        require(balance > 0, "FundFactory: no funds");
        to.transfer(balance);
    }
    
    // ==================== INTERNAL FUNCTIONS ====================
    
    function _validateFundParams(string calldata tokenName, string calldata tokenSymbol, FundToken.FundInfo calldata fundInfo) internal pure returns (bool) {
        return bytes(tokenName).length > 0 && 
               bytes(tokenSymbol).length > 0 && 
               bytes(fundInfo.fundName).length > 0 &&
               fundInfo.manager != address(0) &&
               fundInfo.minimumInvestment > 0 &&
               fundInfo.currentNAV > 0;
    }
    
    function _registerFund(address fundAddress, FundToken.FundInfo calldata fundInfo, address fundHouse) internal {
        fundRegistry[fundAddress] = DeployedFund({
            fundAddress: fundAddress,
            fundName: fundInfo.fundName,
            fundType: fundInfo.fundType,
            fundHouse: fundHouse,
            manager: fundInfo.manager,
            deployedAt: block.timestamp,
            isActive: true
        });
        
        deployedFunds.push(fundAddress);
        fundHouseToFunds[fundHouse].push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        fundHouses[fundHouse].totalFundsCreated++;
    }
    
    function _removeFromApprovedList(address fundHouse) internal {
        for (uint256 i = 0; i < approvedFundHouses.length; i++) {
            if (approvedFundHouses[i] == fundHouse) {
                approvedFundHouses[i] = approvedFundHouses[approvedFundHouses.length - 1];
                approvedFundHouses.pop();
                break;
            }
        }
    }
}
