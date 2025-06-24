// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./FundToken.sol";

/**
 * @title FundFactory - Ultra Minimal
 * @dev Factory for creating FundToken instances
 */
contract FundFactory is Ownable {
    
    mapping(address => bool) public registeredFundHouses;
    address[] public deployedFunds;
    mapping(string => address) public fundNameToAddress;
    
    event FundHouseRegistered(address indexed fundHouse);
    event FundCreated(address indexed fundAddress, address indexed fundHouse, string fundName);
    
    constructor(address initialOwner) Ownable(initialOwner) {}
    
    function registerFundHouse(address fundHouse) external onlyOwner {
        require(fundHouse != address(0), "Invalid address");
        registeredFundHouses[fundHouse] = true;
        emit FundHouseRegistered(fundHouse);
    }
    
    function createFund(
        FundToken.FundInfo calldata fundInfo,
        FundToken.SuitabilityCriteria calldata suitabilityCriteria
    ) external returns (address) {
        require(registeredFundHouses[msg.sender], "Not registered");
        require(bytes(fundInfo.fundName).length > 0, "Invalid name");
        require(fundNameToAddress[fundInfo.fundName] == address(0), "Name exists");
        
        // Create fund token with simple name/symbol
        string memory tokenName = string(abi.encodePacked(fundInfo.fundName, " Token"));
        string memory tokenSymbol = string(abi.encodePacked(fundInfo.fundType, "T"));
        
        FundToken newFund = new FundToken(tokenName, tokenSymbol, fundInfo, suitabilityCriteria);
        address fundAddress = address(newFund);
        
        deployedFunds.push(fundAddress);
        fundNameToAddress[fundInfo.fundName] = fundAddress;
        
        emit FundCreated(fundAddress, msg.sender, fundInfo.fundName);
        return fundAddress;
    }
    
    function getFundCount() external view returns (uint256) {
        return deployedFunds.length;
    }
    
    function getFundByName(string calldata name) external view returns (address) {
        return fundNameToAddress[name];
    }
    
    function isFundHouseRegistered(address fundHouse) external view returns (bool) {
        return registeredFundHouses[fundHouse];
    }
}
