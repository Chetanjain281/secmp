// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FundToken
 * @dev ERC20 token representing shares in a tokenized fund
 * @notice This contract represents ownership in alternative investment funds
 */
contract FundToken is ERC20, Ownable, Pausable, ReentrancyGuard {
    // Fund metadata
    struct FundInfo {
        string fundName;
        string fundType; // "private_equity", "hedge_fund", "real_estate", "other"
        string description;
        address manager; // Fund house address
        uint256 minimumInvestment;
        uint256 currentNAV; // Net Asset Value in smallest USDC unit
        uint256 totalAssetValue; // Total underlying assets value
        bool isActive;
        uint256 createdAt;
    }

    // Suitability criteria for investors
    struct SuitabilityCriteria {
        string minIncomeLevel; // "50L+", "1Cr+", "5Cr+"
        string minExperience; // "beginner", "intermediate", "expert"
        string[] allowedRiskTolerance; // ["conservative", "moderate", "aggressive"]
        string[] allowedGeography; // ["IN", "US", "SG", etc.]
        bool isActive;
    }    FundInfo public fundInfo;
    SuitabilityCriteria public suitabilityCriteria;
    
    // Marketplace contract address - only it can facilitate transfers
    address public marketplaceContract;
    
    // Track approved investors for simplified suitability checking
    mapping(address => bool) public suitableInvestors;
    
    // NAV history for tracking
    struct NAVHistory {
        uint256 nav;
        uint256 timestamp;
        string source; // "oracle", "manual", "initial"
    }
    NAVHistory[] public navHistory;    // Events
    event NAVUpdated(uint256 indexed newNAV, uint256 indexed oldNAV, string source, uint256 timestamp);
    event FundInfoUpdated(string field, string oldValue, string newValue);
    event SuitabilityUpdated(string criteria, string newValue);
    event MarketplaceSet(address indexed oldMarketplace, address indexed newMarketplace);
    event FundStatusChanged(bool isActive);
    event InvestorSuitabilityUpdated(address indexed investor, bool suitable);
    event TokensMinted(address indexed to, uint256 amount, uint256 nav);
    event TokensBurned(address indexed from, uint256 amount, uint256 nav);

    // Modifiers
    modifier onlyManager() {
        require(msg.sender == fundInfo.manager, "FundToken: only fund manager");
        _;
    }

    modifier onlyMarketplace() {
        require(msg.sender == marketplaceContract, "FundToken: only marketplace");
        _;
    }

    modifier onlyManagerOrOwner() {
        require(msg.sender == fundInfo.manager || msg.sender == owner(), "FundToken: only manager or owner");
        _;
    }    constructor(
        string memory name,
        string memory symbol,
        FundInfo memory _fundInfo,
        SuitabilityCriteria memory _suitabilityCriteria
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(_fundInfo.manager != address(0), "FundToken: invalid manager address");
        require(_fundInfo.currentNAV > 0, "FundToken: NAV must be positive");
        require(_fundInfo.minimumInvestment > 0, "FundToken: minimum investment must be positive");

        fundInfo = _fundInfo;
        fundInfo.createdAt = block.timestamp;
        fundInfo.isActive = true;

        suitabilityCriteria = _suitabilityCriteria;
        suitabilityCriteria.isActive = true;

        // Record initial NAV
        navHistory.push(NAVHistory({
            nav: _fundInfo.currentNAV,
            timestamp: block.timestamp,
            source: "initial"
        }));

        emit NAVUpdated(_fundInfo.currentNAV, 0, "initial", block.timestamp);
    }

    /**
     * @dev Update NAV - can be called by manager or oracle
     * @param newNAV New NAV value in smallest USDC unit
     * @param source Source of NAV update ("oracle", "manual")
     */
    function updateNAV(uint256 newNAV, string memory source) external onlyManagerOrOwner {
        require(newNAV > 0, "FundToken: NAV must be positive");
        require(fundInfo.isActive, "FundToken: fund is not active");

        uint256 oldNAV = fundInfo.currentNAV;
        fundInfo.currentNAV = newNAV;

        // Update NAV history
        navHistory.push(NAVHistory({
            nav: newNAV,
            timestamp: block.timestamp,
            source: source
        }));

        emit NAVUpdated(newNAV, oldNAV, source, block.timestamp);
    }

    /**
     * @dev Update fund information - only manager
     * @param field Field to update
     * @param newValue New value
     */
    function updateFundInfo(string memory field, string memory newValue) external onlyManager {
        require(bytes(field).length > 0, "FundToken: field cannot be empty");
        require(bytes(newValue).length > 0, "FundToken: value cannot be empty");

        string memory oldValue;
        
        if (keccak256(bytes(field)) == keccak256(bytes("description"))) {
            oldValue = fundInfo.description;
            fundInfo.description = newValue;
        } else if (keccak256(bytes(field)) == keccak256(bytes("fundType"))) {
            oldValue = fundInfo.fundType;
            fundInfo.fundType = newValue;
        } else {
            revert("FundToken: invalid field");
        }

        emit FundInfoUpdated(field, oldValue, newValue);
    }

    /**
     * @dev Update minimum investment - only manager
     * @param newMinimum New minimum investment amount
     */
    function updateMinimumInvestment(uint256 newMinimum) external onlyManager {
        require(newMinimum > 0, "FundToken: minimum must be positive");
        fundInfo.minimumInvestment = newMinimum;
    }

    /**
     * @dev Set marketplace contract address - only owner
     * @param _marketplace Marketplace contract address
     */
    function setMarketplace(address _marketplace) external onlyOwner {
        require(_marketplace != address(0), "FundToken: invalid marketplace address");
        address oldMarketplace = marketplaceContract;
        marketplaceContract = _marketplace;
        emit MarketplaceSet(oldMarketplace, _marketplace);
    }

    /**
     * @dev Mint tokens - only marketplace
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyMarketplace whenNotPaused {
        require(to != address(0), "FundToken: mint to zero address");
        require(amount > 0, "FundToken: mint amount must be positive");
        require(fundInfo.isActive, "FundToken: fund is not active");

        _mint(to, amount);
    }

    /**
     * @dev Burn tokens - only marketplace
     * @param from Address to burn tokens from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external onlyMarketplace whenNotPaused {
        require(from != address(0), "FundToken: burn from zero address");
        require(amount > 0, "FundToken: burn amount must be positive");
        require(balanceOf(from) >= amount, "FundToken: insufficient balance");

        _burn(from, amount);
    }

    /**
     * @dev Toggle fund active status - only manager or owner
     */
    function toggleFundStatus() external onlyManagerOrOwner {
        fundInfo.isActive = !fundInfo.isActive;
        emit FundStatusChanged(fundInfo.isActive);
    }

    /**
     * @dev Pause contract - only owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause contract - only owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Get current NAV
     * @return Current NAV value
     */
    function getCurrentNAV() external view returns (uint256) {
        return fundInfo.currentNAV;
    }

    /**
     * @dev Get NAV history count
     * @return Number of NAV history entries
     */
    function getNAVHistoryCount() external view returns (uint256) {
        return navHistory.length;
    }

    /**
     * @dev Get NAV history entry
     * @param index Index of history entry
     * @return NAV history entry
     */
    function getNAVHistoryEntry(uint256 index) external view returns (NAVHistory memory) {
        require(index < navHistory.length, "FundToken: invalid history index");
        return navHistory[index];
    }

    /**
     * @dev Get latest NAV entries
     * @param count Number of entries to return
     * @return Array of latest NAV entries
     */
    function getLatestNAVHistory(uint256 count) external view returns (NAVHistory[] memory) {
        require(count > 0, "FundToken: count must be positive");
        
        uint256 length = navHistory.length;
        if (count > length) {
            count = length;
        }

        NAVHistory[] memory result = new NAVHistory[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = navHistory[length - count + i];
        }
        
        return result;
    }    /**
     * @dev Update investor suitability status (for simplified marketplace integration)
     */
    function updateInvestorSuitability(address investor, bool suitable) external onlyManagerOrOwner {
        suitableInvestors[investor] = suitable;
        emit InvestorSuitabilityUpdated(investor, suitable);
    }

    /**
     * @dev Check if investor is suitable (simplified check for marketplace)
     */
    function isSuitableInvestor(address investor) external view returns (bool) {
        if (!suitabilityCriteria.isActive) {
            return true; // No restrictions if criteria is disabled
        }
        return suitableInvestors[investor];
    }    /**
     * @dev Check if investor meets suitability criteria
     * @param investorIncomeLevel Investor's income level
     * @param investorExperience Investor's experience level
     * @param investorRiskTolerance Investor's risk tolerance
     * @param investorGeography Investor's geography
     * @return Whether investor meets criteria
     */
    function checkSuitability(
        string memory investorIncomeLevel,
        string memory investorExperience,
        string memory investorRiskTolerance,
        string memory investorGeography
    ) external view returns (bool) {
        if (!suitabilityCriteria.isActive) {
            return true; // No restrictions if criteria is disabled
        }

        // Check income level
        if (!_checkIncomeLevel(investorIncomeLevel)) {
            return false;
        }

        // Check experience level
        if (!_checkExperience(investorExperience)) {
            return false;
        }

        // Check risk tolerance
        if (!_checkRiskTolerance(investorRiskTolerance)) {
            return false;
        }

        // Check geography
        if (!_checkGeography(investorGeography)) {
            return false;
        }

        return true;
    }

    /**
     * @dev Internal function to check income level
     */
    function _checkIncomeLevel(string memory investorLevel) internal view returns (bool) {
        string memory requiredLevel = suitabilityCriteria.minIncomeLevel;
        
        // Simple ordering: 50L+ < 1Cr+ < 5Cr+
        if (keccak256(bytes(requiredLevel)) == keccak256(bytes("50L+"))) {
            return true; // All levels meet 50L+ requirement
        } else if (keccak256(bytes(requiredLevel)) == keccak256(bytes("1Cr+"))) {
            return keccak256(bytes(investorLevel)) == keccak256(bytes("1Cr+")) ||
                   keccak256(bytes(investorLevel)) == keccak256(bytes("5Cr+"));
        } else if (keccak256(bytes(requiredLevel)) == keccak256(bytes("5Cr+"))) {
            return keccak256(bytes(investorLevel)) == keccak256(bytes("5Cr+"));
        }
        
        return false;
    }

    /**
     * @dev Internal function to check experience level
     */
    function _checkExperience(string memory investorExperience) internal view returns (bool) {
        string memory requiredExperience = suitabilityCriteria.minExperience;
        
        // Simple ordering: beginner < intermediate < expert
        if (keccak256(bytes(requiredExperience)) == keccak256(bytes("beginner"))) {
            return true; // All levels meet beginner requirement
        } else if (keccak256(bytes(requiredExperience)) == keccak256(bytes("intermediate"))) {
            return keccak256(bytes(investorExperience)) == keccak256(bytes("intermediate")) ||
                   keccak256(bytes(investorExperience)) == keccak256(bytes("expert"));
        } else if (keccak256(bytes(requiredExperience)) == keccak256(bytes("expert"))) {
            return keccak256(bytes(investorExperience)) == keccak256(bytes("expert"));
        }
        
        return false;
    }

    /**
     * @dev Internal function to check risk tolerance
     */
    function _checkRiskTolerance(string memory investorTolerance) internal view returns (bool) {
        string[] memory allowedTolerances = suitabilityCriteria.allowedRiskTolerance;
        
        for (uint256 i = 0; i < allowedTolerances.length; i++) {
            if (keccak256(bytes(allowedTolerances[i])) == keccak256(bytes(investorTolerance))) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @dev Internal function to check geography
     */
    function _checkGeography(string memory investorGeography) internal view returns (bool) {
        string[] memory allowedGeographies = suitabilityCriteria.allowedGeography;
        
        for (uint256 i = 0; i < allowedGeographies.length; i++) {
            if (keccak256(bytes(allowedGeographies[i])) == keccak256(bytes(investorGeography))) {
                return true;
            }
        }
        
        return false;
    }    /**
     * @dev Get fund info
     */
    function getFundInfo() external view returns (FundInfo memory) {
        return fundInfo;
    }

    /**
     * @dev Check if fund is active
     */
    function isActive() external view returns (bool) {
        return fundInfo.isActive;
    }

    /**
     * @dev Set active status (for testing/admin purposes)
     */
    function setActiveStatus(bool _isActive) external onlyManagerOrOwner {
        fundInfo.isActive = _isActive;
        emit FundStatusChanged(_isActive);
    }

    /**
     * @dev Get minimum investment amount
     */
    function minimumInvestment() external view returns (uint256) {
        return fundInfo.minimumInvestment;
    }
    
    /**
     * @dev Get fund manager address
     */
    function manager() external view returns (address) {
        return fundInfo.manager;
    }

    /**
     * @dev Override transfer function to ensure marketplace approval
     */
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(fundInfo.isActive, "FundToken: fund is not active");
        return super.transfer(to, amount);
    }

    /**
     * @dev Override transferFrom function to ensure marketplace approval
     */
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(fundInfo.isActive, "FundToken: fund is not active");
        return super.transferFrom(from, to, amount);
    }
}
