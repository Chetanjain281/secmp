// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token for testing and POC purposes
 * @notice This contract simulates USDC functionality for the marketplace
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6; // USDC has 6 decimals
    uint256 public constant MAX_SUPPLY = 1000000000 * 10**DECIMALS; // 1 billion USDC max supply

    // Events
    event TokensMinted(address indexed to, uint256 amount, string reason);
    event TokensBurned(address indexed from, uint256 amount, string reason);

    constructor() ERC20("Mock USD Coin", "MockUSDC") Ownable(msg.sender) {
        // Mint initial supply to deployer for testing
        _mint(msg.sender, 100000000 * 10**DECIMALS); // 100M initial supply
        emit TokensMinted(msg.sender, 100000000 * 10**DECIMALS, "Initial Supply");
    }

    /**
     * @dev Returns the number of decimals used to get its user representation
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @dev Mint tokens to an address - used for payment simulation
     * @param to Address to mint tokens to
     * @param amount Amount to mint (in smallest unit)
     * @param reason Reason for minting (for tracking)
     */
    function mint(address to, uint256 amount, string memory reason) external onlyOwner {
        require(to != address(0), "MockUSDC: mint to zero address");
        require(amount > 0, "MockUSDC: mint amount must be positive");
        require(totalSupply() + amount <= MAX_SUPPLY, "MockUSDC: would exceed max supply");

        _mint(to, amount);
        emit TokensMinted(to, amount, reason);
    }

    /**
     * @dev Burn tokens from an address - used for payment processing
     * @param from Address to burn tokens from
     * @param amount Amount to burn (in smallest unit)
     * @param reason Reason for burning (for tracking)
     */
    function burn(address from, uint256 amount, string memory reason) external onlyOwner {
        require(from != address(0), "MockUSDC: burn from zero address");
        require(amount > 0, "MockUSDC: burn amount must be positive");
        require(balanceOf(from) >= amount, "MockUSDC: insufficient balance to burn");

        _burn(from, amount);
        emit TokensBurned(from, amount, reason);
    }

    /**
     * @dev Batch mint tokens to multiple addresses - useful for testing
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     * @param reason Reason for batch minting
     */
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts,
        string memory reason
    ) external onlyOwner {
        require(recipients.length == amounts.length, "MockUSDC: arrays length mismatch");
        require(recipients.length <= 100, "MockUSDC: too many recipients");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        require(totalSupply() + totalAmount <= MAX_SUPPLY, "MockUSDC: would exceed max supply");

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "MockUSDC: mint to zero address");
            require(amounts[i] > 0, "MockUSDC: mint amount must be positive");
            
            _mint(recipients[i], amounts[i]);
            emit TokensMinted(recipients[i], amounts[i], reason);
        }
    }

    /**
     * @dev Emergency withdrawal function for owner
     * @param to Address to send tokens to
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MockUSDC: withdraw to zero address");
        require(balanceOf(address(this)) >= amount, "MockUSDC: insufficient contract balance");
        
        _transfer(address(this), to, amount);
    }

    /**
     * @dev Get human readable balance (with decimals)
     * @param account Address to check balance for
     * @return Human readable balance
     */
    function getReadableBalance(address account) external view returns (string memory) {
        uint256 balance = balanceOf(account);
        uint256 whole = balance / 10**DECIMALS;
        uint256 fraction = balance % 10**DECIMALS;
        
        return string(abi.encodePacked(
            _uintToString(whole),
            ".",
            _padZeros(_uintToString(fraction), DECIMALS)
        ));
    }

    /**
     * @dev Convert uint to string
     */
    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Pad string with leading zeros
     */
    function _padZeros(string memory str, uint256 targetLength) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        if (strBytes.length >= targetLength) {
            return str;
        }
        
        bytes memory result = new bytes(targetLength);
        uint256 padding = targetLength - strBytes.length;
        
        for (uint256 i = 0; i < padding; i++) {
            result[i] = "0";
        }
        for (uint256 i = 0; i < strBytes.length; i++) {
            result[padding + i] = strBytes[i];
        }
        
        return string(result);
    }
}
