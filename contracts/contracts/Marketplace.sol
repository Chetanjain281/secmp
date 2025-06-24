// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./FundToken.sol";

/**
 * @title Marketplace
 * @dev Unified marketplace for primary and secondary trading of tokenized funds
 * Features:
 * - Primary market: Buy directly from fund house at NAV price
 * - Secondary market: P2P trading with custom pricing
 * - Token locking mechanism to prevent double-spending
 * - USDC settlement integration
 * - Suitability checking before trades
 */
contract Marketplace is ReentrancyGuard, Pausable, Ownable {
    // State variables
    IERC20 public immutable usdcToken;
    uint256 public tradingFeeRate = 25; // 0.25% (25 basis points)
    uint256 public constant MAX_FEE_RATE = 100; // 1% maximum
    
    // Structs
    struct Listing {
        address seller;
        address fundToken;
        uint256 tokenAmount;
        uint256 pricePerToken;
        bool isActive;
        uint256 createdAt;
    }
    
    struct Trade {
        address buyer;
        address seller;
        address fundToken;
        uint256 tokenAmount;
        uint256 totalPrice;
        uint256 fee;
        bool isPrimaryMarket;
        uint256 executedAt;
    }
    
    // Mappings
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256[]) public userListings;
    mapping(address => mapping(address => uint256)) public lockedTokens; // user => fundToken => amount
    mapping(address => bool) public authorizedFunds;
    
    // Arrays and counters
    uint256 public nextListingId = 1;
    uint256[] public activeListings;
    Trade[] public tradeHistory;
    
    // Events
    event FundAuthorized(address indexed fundToken, bool authorized);
    event TokensListed(uint256 indexed listingId, address indexed seller, address indexed fundToken, uint256 amount, uint256 price);
    event TokensUnlisted(uint256 indexed listingId, address indexed seller);
    event PrimaryTrade(address indexed buyer, address indexed fundToken, uint256 amount, uint256 totalPrice, uint256 fee);
    event SecondaryTrade(uint256 indexed listingId, address indexed buyer, address indexed seller, address fundToken, uint256 amount, uint256 totalPrice, uint256 fee);
    event TokensLocked(address indexed user, address indexed fundToken, uint256 amount);
    event TokensUnlocked(address indexed user, address indexed fundToken, uint256 amount);
    event TradingFeeUpdated(uint256 oldFee, uint256 newFee);
    
    // Modifiers
    modifier onlyAuthorizedFund(address fundToken) {
        require(authorizedFunds[fundToken], "Fund not authorized");
        _;
    }
    
    modifier validListingId(uint256 listingId) {
        require(listingId > 0 && listingId < nextListingId, "Invalid listing ID");
        require(listings[listingId].isActive, "Listing not active");
        _;
    }
      constructor(address _usdcToken, address _owner) Ownable(_owner) {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_owner != address(0), "Invalid owner address");
        
        usdcToken = IERC20(_usdcToken);
    }
    
    // Admin functions
    function authorizeFund(address fundToken, bool authorized) external onlyOwner {
        require(fundToken != address(0), "Invalid fund token address");
        authorizedFunds[fundToken] = authorized;
        emit FundAuthorized(fundToken, authorized);
    }
    
    function setTradingFee(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= MAX_FEE_RATE, "Fee rate too high");
        uint256 oldFee = tradingFeeRate;
        tradingFeeRate = newFeeRate;
        emit TradingFeeUpdated(oldFee, newFeeRate);
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // Primary market functions
    function buyFromFundHouse(
        address fundToken,
        uint256 tokenAmount
    ) external nonReentrant whenNotPaused onlyAuthorizedFund(fundToken) {
        require(tokenAmount > 0, "Amount must be positive");
        
        FundToken fund = FundToken(fundToken);
        require(fund.isActive(), "Fund not active");
        
        // Check suitability
        require(fund.isSuitableInvestor(msg.sender), "Investor not suitable");
        
        // Check minimum investment
        uint256 currentNAV = fund.getCurrentNAV();
        uint256 totalPrice = tokenAmount * currentNAV / 1e6; // Assuming 6 decimals for USDC
        require(totalPrice >= fund.minimumInvestment(), "Below minimum investment");
        
        // Calculate fee
        uint256 fee = (totalPrice * tradingFeeRate) / 10000;
        uint256 totalCost = totalPrice + fee;
        
        // Transfer USDC from buyer
        require(usdcToken.transferFrom(msg.sender, address(this), totalCost), "USDC transfer failed");
        
        // Transfer fee portion to contract (can be withdrawn by owner)
        // Transfer payment to fund manager/treasury (simplified - in production would go to fund's treasury)
        require(usdcToken.transfer(fund.owner(), totalPrice), "Payment transfer failed");
          // Mint tokens to buyer
        fund.mint(msg.sender, tokenAmount);
        
        // Record trade
        tradeHistory.push(Trade({
            buyer: msg.sender,
            seller: fund.owner(), // Fund house is the seller in primary market
            fundToken: fundToken,
            tokenAmount: tokenAmount,
            totalPrice: totalPrice,
            fee: fee,
            isPrimaryMarket: true,
            executedAt: block.timestamp
        }));
        
        emit PrimaryTrade(msg.sender, fundToken, tokenAmount, totalPrice, fee);
    }
    
    // Secondary market functions
    function listTokensForSale(
        address fundToken,
        uint256 tokenAmount,
        uint256 pricePerToken
    ) external nonReentrant whenNotPaused onlyAuthorizedFund(fundToken) returns (uint256 listingId) {
        require(tokenAmount > 0, "Amount must be positive");
        require(pricePerToken > 0, "Price must be positive");
        
        FundToken fund = FundToken(fundToken);
        require(fund.balanceOf(msg.sender) >= tokenAmount, "Insufficient balance");
        
        // Lock tokens
        _lockTokens(msg.sender, fundToken, tokenAmount);
        
        // Create listing
        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            fundToken: fundToken,
            tokenAmount: tokenAmount,
            pricePerToken: pricePerToken,
            isActive: true,
            createdAt: block.timestamp
        });
        
        userListings[msg.sender].push(listingId);
        activeListings.push(listingId);
        
        emit TokensListed(listingId, msg.sender, fundToken, tokenAmount, pricePerToken);
        return listingId;
    }
    
    function cancelListing(uint256 listingId) external nonReentrant validListingId(listingId) {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Not your listing");
        
        // Unlock tokens
        _unlockTokens(msg.sender, listing.fundToken, listing.tokenAmount);
        
        // Deactivate listing
        listing.isActive = false;
        _removeFromActiveListings(listingId);
        
        emit TokensUnlisted(listingId, msg.sender);
    }
    
    function buyFromInvestor(uint256 listingId) external nonReentrant whenNotPaused validListingId(listingId) {
        Listing storage listing = listings[listingId];
        require(listing.seller != msg.sender, "Cannot buy your own listing");
        
        FundToken fund = FundToken(listing.fundToken);
        require(fund.isSuitableInvestor(msg.sender), "Investor not suitable");
        
        uint256 totalPrice = listing.tokenAmount * listing.pricePerToken / 1e6;
        uint256 fee = (totalPrice * tradingFeeRate) / 10000;
        uint256 totalCost = totalPrice + fee;
        uint256 sellerReceives = totalPrice - fee; // Seller pays half the fee
        
        // Transfer USDC from buyer
        require(usdcToken.transferFrom(msg.sender, address(this), totalCost), "USDC transfer failed");
        
        // Transfer payment to seller (minus fee)
        require(usdcToken.transfer(listing.seller, sellerReceives), "Payment to seller failed");
        
        // Unlock and transfer tokens
        _unlockTokens(listing.seller, listing.fundToken, listing.tokenAmount);
        require(fund.transferFrom(listing.seller, msg.sender, listing.tokenAmount), "Token transfer failed");
        
        // Record trade
        tradeHistory.push(Trade({
            buyer: msg.sender,
            seller: listing.seller,
            fundToken: listing.fundToken,
            tokenAmount: listing.tokenAmount,
            totalPrice: totalPrice,
            fee: fee,
            isPrimaryMarket: false,
            executedAt: block.timestamp
        }));
        
        // Deactivate listing
        listing.isActive = false;
        _removeFromActiveListings(listingId);
        
        emit SecondaryTrade(listingId, msg.sender, listing.seller, listing.fundToken, listing.tokenAmount, totalPrice, fee);
    }
    
    // Token locking functions
    function _lockTokens(address user, address fundToken, uint256 amount) internal {
        lockedTokens[user][fundToken] += amount;
        emit TokensLocked(user, fundToken, amount);
    }
    
    function _unlockTokens(address user, address fundToken, uint256 amount) internal {
        require(lockedTokens[user][fundToken] >= amount, "Insufficient locked tokens");
        lockedTokens[user][fundToken] -= amount;
        emit TokensUnlocked(user, fundToken, amount);
    }
    
    // Helper functions
    function _removeFromActiveListings(uint256 listingId) internal {
        for (uint256 i = 0; i < activeListings.length; i++) {
            if (activeListings[i] == listingId) {
                activeListings[i] = activeListings[activeListings.length - 1];
                activeListings.pop();
                break;
            }
        }
    }
    
    // View functions
    function getActiveListings(uint256 offset, uint256 limit) external view returns (Listing[] memory) {
        require(limit > 0 && limit <= 100, "Invalid limit");
        require(offset < activeListings.length, "Offset out of range");
        
        uint256 end = offset + limit;
        if (end > activeListings.length) {
            end = activeListings.length;
        }
        
        Listing[] memory result = new Listing[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = listings[activeListings[i]];
        }
        
        return result;
    }
    
    function getUserListings(address user) external view returns (uint256[] memory) {
        return userListings[user];
    }
    
    function getLockedTokens(address user, address fundToken) external view returns (uint256) {
        return lockedTokens[user][fundToken];
    }
    
    function getTradeHistory(uint256 offset, uint256 limit) external view returns (Trade[] memory) {
        require(limit > 0 && limit <= 100, "Invalid limit");
        require(offset < tradeHistory.length, "Offset out of range");
        
        uint256 end = offset + limit;
        if (end > tradeHistory.length) {
            end = tradeHistory.length;
        }
        
        Trade[] memory result = new Trade[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = tradeHistory[i];
        }
        
        return result;
    }
    
    function getActiveListingsCount() external view returns (uint256) {
        return activeListings.length;
    }
    
    function getTradeHistoryCount() external view returns (uint256) {
        return tradeHistory.length;
    }
    
    // Owner can withdraw accumulated fees
    function withdrawFees(uint256 amount) external onlyOwner {
        require(amount <= usdcToken.balanceOf(address(this)), "Insufficient balance");
        require(usdcToken.transfer(owner(), amount), "Withdrawal failed");
    }
    
    // Emergency function to withdraw all fees
    function withdrawAllFees() external onlyOwner {
        uint256 balance = usdcToken.balanceOf(address(this));
        require(balance > 0, "No fees to withdraw");
        require(usdcToken.transfer(owner(), balance), "Withdrawal failed");
    }
}
