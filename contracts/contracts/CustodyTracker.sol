// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./FundToken.sol";

/**
 * @title CustodyTracker
 * @dev Tracks custody status and asset backing for tokenized funds
 * Features:
 * - Asset custody verification and tracking
 * - Real-world asset mapping to fund tokens
 * - Custody status updates and history
 * - Oracle integration for asset valuation
 * - Compliance and audit trail
 */
contract CustodyTracker is Ownable, ReentrancyGuard, Pausable {
    
    // Structs
    struct Asset {
        string assetId; // External asset identifier
        string assetType; // "real_estate", "equity", "bond", "commodity", etc.
        string description;
        uint256 valuationUSD; // Asset value in USD (6 decimals)
        uint256 lastValuationDate;
        string custodian; // Custody provider name
        string location; // Physical or virtual location
        bool isActive;
        uint256 createdAt;
    }
    
    struct CustodyRecord {
        address fundToken;
        string assetId;
        uint256 tokensBacked; // Number of fund tokens backed by this asset
        uint256 percentageAllocation; // Percentage of asset backing this fund (in basis points)
        bool isActive;
        uint256 lastUpdated;
    }
    
    struct ValuationUpdate {
        string assetId;
        uint256 oldValuation;
        uint256 newValuation;
        string source; // Oracle or manual update source
        address updatedBy;
        uint256 timestamp;
    }
    
    // State variables
    mapping(string => Asset) public assets;
    mapping(bytes32 => CustodyRecord) public custodyRecords; // keccak256(fundToken, assetId)
    mapping(address => string[]) public fundAssets; // fundToken => assetIds[]
    mapping(string => address[]) public assetFunds; // assetId => fundTokens[]
    mapping(address => bool) public authorizedOracles;
    mapping(address => bool) public authorizedCustodians;
    
    string[] public allAssetIds;
    ValuationUpdate[] public valuationHistory;
    
    uint256 public constant BASIS_POINTS = 10000; // 100% = 10000 basis points
    uint256 public constant MIN_VALUATION = 1e6; // $1 minimum valuation
    
    // Events
    event AssetRegistered(string indexed assetId, string assetType, uint256 valuation);
    event AssetValuationUpdated(string indexed assetId, uint256 oldValuation, uint256 newValuation, string source);
    event CustodyRecordCreated(address indexed fundToken, string indexed assetId, uint256 tokensBacked, uint256 percentage);
    event CustodyRecordUpdated(address indexed fundToken, string indexed assetId, uint256 oldTokens, uint256 newTokens);
    event CustodyRecordDeactivated(address indexed fundToken, string indexed assetId);
    event OracleAuthorized(address indexed oracle, bool authorized);
    event CustodianAuthorized(address indexed custodian, bool authorized);
    
    // Modifiers
    modifier onlyAuthorizedOracle() {
        require(authorizedOracles[msg.sender], "Not authorized oracle");
        _;
    }
    
    modifier onlyAuthorizedCustodian() {
        require(authorizedCustodians[msg.sender], "Not authorized custodian");
        _;
    }
    
    modifier validAsset(string memory assetId) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset not found");
        require(assets[assetId].isActive, "Asset not active");
        _;
    }
    
    constructor(address _owner) Ownable(_owner) {}
    
    // Admin functions
    function authorizeOracle(address oracle, bool authorized) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        authorizedOracles[oracle] = authorized;
        emit OracleAuthorized(oracle, authorized);
    }
    
    function authorizeCustodian(address custodian, bool authorized) external onlyOwner {
        require(custodian != address(0), "Invalid custodian address");
        authorizedCustodians[custodian] = authorized;
        emit CustodianAuthorized(custodian, authorized);
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // Asset management functions
    function registerAsset(
        string memory assetId,
        string memory assetType,
        string memory description,
        uint256 valuationUSD,
        string memory custodian,
        string memory location
    ) external onlyOwner whenNotPaused {
        require(bytes(assetId).length > 0, "Invalid asset ID");
        require(bytes(assets[assetId].assetId).length == 0, "Asset already exists");
        require(valuationUSD >= MIN_VALUATION, "Valuation too low");
        require(bytes(assetType).length > 0, "Invalid asset type");
        
        assets[assetId] = Asset({
            assetId: assetId,
            assetType: assetType,
            description: description,
            valuationUSD: valuationUSD,
            lastValuationDate: block.timestamp,
            custodian: custodian,
            location: location,
            isActive: true,
            createdAt: block.timestamp
        });
        
        allAssetIds.push(assetId);
        
        emit AssetRegistered(assetId, assetType, valuationUSD);
    }
    
    function updateAssetValuation(
        string memory assetId,
        uint256 newValuation,
        string memory source
    ) external onlyAuthorizedOracle validAsset(assetId) whenNotPaused {
        require(newValuation >= MIN_VALUATION, "Valuation too low");
        
        Asset storage asset = assets[assetId];
        uint256 oldValuation = asset.valuationUSD;
        
        asset.valuationUSD = newValuation;
        asset.lastValuationDate = block.timestamp;
        
        // Record valuation history
        valuationHistory.push(ValuationUpdate({
            assetId: assetId,
            oldValuation: oldValuation,
            newValuation: newValuation,
            source: source,
            updatedBy: msg.sender,
            timestamp: block.timestamp
        }));
        
        emit AssetValuationUpdated(assetId, oldValuation, newValuation, source);
    }
    
    function deactivateAsset(string memory assetId) external onlyOwner validAsset(assetId) {
        assets[assetId].isActive = false;
        
        // Deactivate all custody records for this asset
        address[] memory funds = assetFunds[assetId];
        for (uint256 i = 0; i < funds.length; i++) {
            bytes32 recordKey = keccak256(abi.encodePacked(funds[i], assetId));
            if (custodyRecords[recordKey].isActive) {
                custodyRecords[recordKey].isActive = false;
                emit CustodyRecordDeactivated(funds[i], assetId);
            }
        }
    }
    
    // Custody management functions
    function createCustodyRecord(
        address fundToken,
        string memory assetId,
        uint256 tokensBacked,
        uint256 percentageAllocation
    ) external onlyAuthorizedCustodian validAsset(assetId) whenNotPaused nonReentrant {
        require(fundToken != address(0), "Invalid fund token");
        require(tokensBacked > 0, "Tokens backed must be positive");
        require(percentageAllocation > 0 && percentageAllocation <= BASIS_POINTS, "Invalid percentage");
        
        bytes32 recordKey = keccak256(abi.encodePacked(fundToken, assetId));
        require(!custodyRecords[recordKey].isActive, "Custody record already exists");
        
        // Verify fund token is valid
        FundToken fund = FundToken(fundToken);
        require(fund.totalSupply() >= tokensBacked, "Insufficient fund tokens");
        
        // Create custody record
        custodyRecords[recordKey] = CustodyRecord({
            fundToken: fundToken,
            assetId: assetId,
            tokensBacked: tokensBacked,
            percentageAllocation: percentageAllocation,
            isActive: true,
            lastUpdated: block.timestamp
        });
        
        // Update mappings
        fundAssets[fundToken].push(assetId);
        assetFunds[assetId].push(fundToken);
        
        emit CustodyRecordCreated(fundToken, assetId, tokensBacked, percentageAllocation);
    }
    
    function updateCustodyRecord(
        address fundToken,
        string memory assetId,
        uint256 newTokensBacked
    ) external onlyAuthorizedCustodian validAsset(assetId) whenNotPaused {
        require(fundToken != address(0), "Invalid fund token");
        require(newTokensBacked > 0, "Tokens backed must be positive");
        
        bytes32 recordKey = keccak256(abi.encodePacked(fundToken, assetId));
        require(custodyRecords[recordKey].isActive, "Custody record not found");
        
        uint256 oldTokens = custodyRecords[recordKey].tokensBacked;
        custodyRecords[recordKey].tokensBacked = newTokensBacked;
        custodyRecords[recordKey].lastUpdated = block.timestamp;
        
        emit CustodyRecordUpdated(fundToken, assetId, oldTokens, newTokensBacked);
    }
    
    function deactivateCustodyRecord(
        address fundToken,
        string memory assetId
    ) external onlyAuthorizedCustodian {
        bytes32 recordKey = keccak256(abi.encodePacked(fundToken, assetId));
        require(custodyRecords[recordKey].isActive, "Custody record not found");
        
        custodyRecords[recordKey].isActive = false;
        custodyRecords[recordKey].lastUpdated = block.timestamp;
        
        emit CustodyRecordDeactivated(fundToken, assetId);
    }
    
    // View functions
    function getAsset(string memory assetId) external view returns (Asset memory) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset not found");
        return assets[assetId];
    }
    
    function getCustodyRecord(address fundToken, string memory assetId) external view returns (CustodyRecord memory) {
        bytes32 recordKey = keccak256(abi.encodePacked(fundToken, assetId));
        return custodyRecords[recordKey];
    }
    
    function getFundAssets(address fundToken) external view returns (string[] memory) {
        return fundAssets[fundToken];
    }
    
    function getAssetFunds(string memory assetId) external view returns (address[] memory) {
        return assetFunds[assetId];
    }
    
    function getAllAssets() external view returns (string[] memory) {
        return allAssetIds;
    }
    
    function getAssetCount() external view returns (uint256) {
        return allAssetIds.length;
    }
    
    function getValuationHistoryCount() external view returns (uint256) {
        return valuationHistory.length;
    }
    
    function getValuationHistory(uint256 offset, uint256 limit) external view returns (ValuationUpdate[] memory) {
        require(limit > 0 && limit <= 100, "Invalid limit");
        require(offset < valuationHistory.length, "Offset out of range");
        
        uint256 end = offset + limit;
        if (end > valuationHistory.length) {
            end = valuationHistory.length;
        }
        
        ValuationUpdate[] memory result = new ValuationUpdate[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = valuationHistory[i];
        }
        
        return result;
    }
    
    // Fund backing calculation functions
    function getFundBackingValue(address fundToken) external view returns (uint256 totalBackingUSD) {
        string[] memory assetIds = fundAssets[fundToken];
        
        for (uint256 i = 0; i < assetIds.length; i++) {
            bytes32 recordKey = keccak256(abi.encodePacked(fundToken, assetIds[i]));
            CustodyRecord memory record = custodyRecords[recordKey];
            
            if (record.isActive) {
                Asset memory asset = assets[assetIds[i]];
                if (asset.isActive) {
                    // Calculate backing value: (asset value * percentage allocation) / 10000
                    uint256 assetBackingValue = (asset.valuationUSD * record.percentageAllocation) / BASIS_POINTS;
                    totalBackingUSD += assetBackingValue;
                }
            }
        }
    }
    
    function getFundBackingRatio(address fundToken) external view returns (uint256 ratio) {
        FundToken fund = FundToken(fundToken);
        uint256 totalSupply = fund.totalSupply();
        
        if (totalSupply == 0) {
            return 0;
        }
        
        uint256 backingValue = this.getFundBackingValue(fundToken);
        uint256 currentNAV = fund.getCurrentNAV();
        uint256 totalNAVValue = (totalSupply * currentNAV) / 1e6; // Convert from 6 decimals
        
        if (totalNAVValue == 0) {
            return 0;
        }
        
        // Return ratio in basis points (10000 = 100%)
        return (backingValue * BASIS_POINTS) / totalNAVValue;
    }
    
    function isFullyBacked(address fundToken) external view returns (bool) {
        uint256 backingRatio = this.getFundBackingRatio(fundToken);
        return backingRatio >= BASIS_POINTS; // 100% or more
    }
}
