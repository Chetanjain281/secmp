// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Settlement
 * @dev Advanced settlement system for tokenized fund marketplace
 * Handles escrow, batch settlements, dispute resolution, and settlement finalization
 */
contract Settlement is Ownable, ReentrancyGuard, Pausable {
    
    // Settlement States
    enum SettlementStatus {
        Pending,
        InEscrow,
        Disputed,
        Resolved,
        Completed,
        Cancelled
    }
    
    // Dispute States
    enum DisputeStatus {
        None,
        Raised,
        UnderReview,
        Resolved
    }
    
    // Settlement Structure
    struct SettlementRecord {
        uint256 settlementId;
        address buyer;
        address seller;
        address fundToken;
        address paymentToken;
        uint256 tokenAmount;
        uint256 paymentAmount;
        uint256 settlementDate;
        uint256 createdAt;
        SettlementStatus status;
        DisputeStatus disputeStatus;
        string disputeReason;
        address disputeResolver;
        uint256 escrowReleaseTime;
        bool buyerConfirmed;
        bool sellerConfirmed;
        uint256 settlementFee;
        address feeRecipient;
    }
    
    // Escrow Structure
    struct EscrowRecord {
        uint256 escrowId;
        uint256 settlementId;
        address depositor;
        address token;
        uint256 amount;
        uint256 releaseTime;
        bool released;
        string purpose;
    }
    
    // Batch Settlement Structure
    struct BatchSettlement {
        uint256 batchId;
        uint256[] settlementIds;
        uint256 totalTokens;
        uint256 totalPayment;
        address fundToken;
        address paymentToken;
        uint256 executionTime;
        bool executed;
        address executor;
    }
    
    // State Variables
    mapping(uint256 => SettlementRecord) public settlements;
    mapping(uint256 => EscrowRecord) public escrows;
    mapping(uint256 => BatchSettlement) public batchSettlements;
    mapping(address => uint256[]) public userSettlements;
    mapping(address => mapping(address => uint256)) public escrowBalances;
    mapping(address => bool) public authorizedResolvers;
    
    uint256 public nextSettlementId = 1;
    uint256 public nextEscrowId = 1;
    uint256 public nextBatchId = 1;
    
    // Settlement Configuration
    uint256 public defaultEscrowPeriod = 24 hours;
    uint256 public disputePeriod = 7 days;
    uint256 public settlementFeeRate = 25; // 0.25% (basis points)
    uint256 public maxBatchSize = 50;
    address public feeRecipient;
    
    // Events
    event SettlementCreated(
        uint256 indexed settlementId,
        address indexed buyer,
        address indexed seller,
        address fundToken,
        uint256 tokenAmount,
        uint256 paymentAmount
    );
    
    event SettlementConfirmed(
        uint256 indexed settlementId,
        address indexed confirmer,
        bool buyerConfirmed,
        bool sellerConfirmed
    );
    
    event EscrowDeposited(
        uint256 indexed escrowId,
        uint256 indexed settlementId,
        address indexed depositor,
        address token,
        uint256 amount
    );
    
    event EscrowReleased(
        uint256 indexed escrowId,
        address indexed recipient,
        uint256 amount
    );
    
    event DisputeRaised(
        uint256 indexed settlementId,
        address indexed disputant,
        string reason
    );
    
    event DisputeResolved(
        uint256 indexed settlementId,
        address indexed resolver,
        bool buyerFavored
    );
    
    event SettlementCompleted(
        uint256 indexed settlementId,
        uint256 completedAt
    );
    
    event BatchSettlementCreated(
        uint256 indexed batchId,
        uint256 settlementCount,
        address executor
    );
    
    event BatchSettlementExecuted(
        uint256 indexed batchId,
        uint256 executedAt
    );
    
    event SettlementCancelled(
        uint256 indexed settlementId,
        string reason
    );
    
    // Custom Errors
    error InvalidSettlement();
    error UnauthorizedAccess();
    error SettlementNotPending();
    error InsufficientEscrow();
    error DisputePeriodActive();
    error InvalidBatchSize();
    error BatchAlreadyExecuted();
    error EscrowNotMatured();
    error InvalidFeeRate();
    error ZeroAmount();
    error TokenTransferFailed();
    
    constructor(address _feeRecipient) Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
        authorizedResolvers[msg.sender] = true;
    }
    
    /**
     * @dev Create a new settlement record
     */
    function createSettlement(
        address _buyer,
        address _seller,
        address _fundToken,
        address _paymentToken,
        uint256 _tokenAmount,
        uint256 _paymentAmount,
        uint256 _settlementDate
    ) external whenNotPaused returns (uint256) {
        if (_buyer == address(0) || _seller == address(0)) revert InvalidSettlement();
        if (_fundToken == address(0) || _paymentToken == address(0)) revert InvalidSettlement();
        if (_tokenAmount == 0 || _paymentAmount == 0) revert ZeroAmount();
        
        uint256 settlementId = nextSettlementId++;
        uint256 fee = (_paymentAmount * settlementFeeRate) / 10000;
        
        settlements[settlementId] = SettlementRecord({
            settlementId: settlementId,
            buyer: _buyer,
            seller: _seller,
            fundToken: _fundToken,
            paymentToken: _paymentToken,
            tokenAmount: _tokenAmount,
            paymentAmount: _paymentAmount,
            settlementDate: _settlementDate,
            createdAt: block.timestamp,
            status: SettlementStatus.Pending,
            disputeStatus: DisputeStatus.None,
            disputeReason: "",
            disputeResolver: address(0),
            escrowReleaseTime: block.timestamp + defaultEscrowPeriod,
            buyerConfirmed: false,
            sellerConfirmed: false,
            settlementFee: fee,
            feeRecipient: feeRecipient
        });
        
        userSettlements[_buyer].push(settlementId);
        userSettlements[_seller].push(settlementId);
        
        emit SettlementCreated(
            settlementId,
            _buyer,
            _seller,
            _fundToken,
            _tokenAmount,
            _paymentAmount
        );
        
        return settlementId;
    }
    
    /**
     * @dev Deposit funds into escrow for settlement
     */
    function depositEscrow(
        uint256 _settlementId,
        address _token,
        uint256 _amount,
        string calldata _purpose
    ) external nonReentrant whenNotPaused returns (uint256) {
        SettlementRecord storage settlement = settlements[_settlementId];
        if (settlement.settlementId == 0) revert InvalidSettlement();
        if (_amount == 0) revert ZeroAmount();
        
        // Transfer tokens to contract
        IERC20 token = IERC20(_token);
        if (!token.transferFrom(msg.sender, address(this), _amount)) {
            revert TokenTransferFailed();
        }
        
        uint256 escrowId = nextEscrowId++;
        
        escrows[escrowId] = EscrowRecord({
            escrowId: escrowId,
            settlementId: _settlementId,
            depositor: msg.sender,
            token: _token,
            amount: _amount,
            releaseTime: settlement.escrowReleaseTime,
            released: false,
            purpose: _purpose
        });
        
        escrowBalances[msg.sender][_token] += _amount;
        
        // Update settlement status
        if (settlement.status == SettlementStatus.Pending) {
            settlement.status = SettlementStatus.InEscrow;
        }
        
        emit EscrowDeposited(escrowId, _settlementId, msg.sender, _token, _amount);
        
        return escrowId;
    }
    
    /**
     * @dev Confirm settlement by buyer or seller
     */
    function confirmSettlement(uint256 _settlementId) external whenNotPaused {
        SettlementRecord storage settlement = settlements[_settlementId];
        if (settlement.settlementId == 0) revert InvalidSettlement();
        
        if (msg.sender == settlement.buyer) {
            settlement.buyerConfirmed = true;
        } else if (msg.sender == settlement.seller) {
            settlement.sellerConfirmed = true;
        } else {
            revert UnauthorizedAccess();
        }
        
        emit SettlementConfirmed(
            _settlementId,
            msg.sender,
            settlement.buyerConfirmed,
            settlement.sellerConfirmed
        );
        
        // Auto-complete if both parties confirmed
        if (settlement.buyerConfirmed && settlement.sellerConfirmed) {
            _completeSettlement(_settlementId);
        }
    }
    
    /**
     * @dev Raise a dispute for settlement
     */
    function raiseDispute(
        uint256 _settlementId,
        string calldata _reason
    ) external whenNotPaused {
        SettlementRecord storage settlement = settlements[_settlementId];
        if (settlement.settlementId == 0) revert InvalidSettlement();
        if (msg.sender != settlement.buyer && msg.sender != settlement.seller) {
            revert UnauthorizedAccess();
        }
        if (settlement.status == SettlementStatus.Completed) revert InvalidSettlement();
        
        settlement.disputeStatus = DisputeStatus.Raised;
        settlement.disputeReason = _reason;
        settlement.status = SettlementStatus.Disputed;
        
        emit DisputeRaised(_settlementId, msg.sender, _reason);
    }
    
    /**
     * @dev Resolve dispute (only authorized resolvers)
     */
    function resolveDispute(
        uint256 _settlementId,
        bool _buyerFavored
    ) external whenNotPaused {
        if (!authorizedResolvers[msg.sender]) revert UnauthorizedAccess();
        
        SettlementRecord storage settlement = settlements[_settlementId];
        if (settlement.settlementId == 0) revert InvalidSettlement();
        if (settlement.disputeStatus != DisputeStatus.Raised) revert InvalidSettlement();
        
        settlement.disputeStatus = DisputeStatus.Resolved;
        settlement.disputeResolver = msg.sender;
        settlement.status = SettlementStatus.Resolved;
        
        emit DisputeResolved(_settlementId, msg.sender, _buyerFavored);
        
        // Auto-complete resolution
        _completeSettlement(_settlementId);
    }
    
    /**
     * @dev Release escrow funds
     */
    function releaseEscrow(uint256 _escrowId) external nonReentrant whenNotPaused {
        EscrowRecord storage escrow = escrows[_escrowId];
        if (escrow.escrowId == 0) revert InvalidSettlement();
        if (escrow.released) revert InvalidSettlement();
        if (block.timestamp < escrow.releaseTime) revert EscrowNotMatured();
        
        SettlementRecord storage settlement = settlements[escrow.settlementId];
        
        // Only allow release if settlement is completed or dispute resolved
        if (settlement.status != SettlementStatus.Completed && 
            settlement.status != SettlementStatus.Resolved) {
            revert InvalidSettlement();
        }
        
        escrow.released = true;
        escrowBalances[escrow.depositor][escrow.token] -= escrow.amount;
        
        // Determine recipient based on settlement outcome
        address recipient = escrow.depositor;
        if (settlement.disputeStatus == DisputeStatus.Resolved) {
            // Handle dispute resolution logic here
            recipient = escrow.depositor; // Simplified - could be more complex
        }
        
        IERC20 token = IERC20(escrow.token);
        if (!token.transfer(recipient, escrow.amount)) {
            revert TokenTransferFailed();
        }
        
        emit EscrowReleased(_escrowId, recipient, escrow.amount);
    }
    
    /**
     * @dev Create batch settlement
     */
    function createBatchSettlement(
        uint256[] calldata _settlementIds
    ) external whenNotPaused returns (uint256) {
        if (_settlementIds.length == 0 || _settlementIds.length > maxBatchSize) {
            revert InvalidBatchSize();
        }
        
        uint256 batchId = nextBatchId++;
        uint256 totalTokens;
        uint256 totalPayment;
        address fundToken;
        address paymentToken;
        
        // Validate all settlements in batch
        for (uint256 i = 0; i < _settlementIds.length; i++) {
            SettlementRecord storage settlement = settlements[_settlementIds[i]];
            if (settlement.settlementId == 0) revert InvalidSettlement();
            if (settlement.status != SettlementStatus.InEscrow) revert SettlementNotPending();
            
            if (i == 0) {
                fundToken = settlement.fundToken;
                paymentToken = settlement.paymentToken;
            } else {
                // Ensure all settlements use same tokens
                if (settlement.fundToken != fundToken || 
                    settlement.paymentToken != paymentToken) {
                    revert InvalidSettlement();
                }
            }
            
            totalTokens += settlement.tokenAmount;
            totalPayment += settlement.paymentAmount;
        }
        
        batchSettlements[batchId] = BatchSettlement({
            batchId: batchId,
            settlementIds: _settlementIds,
            totalTokens: totalTokens,
            totalPayment: totalPayment,
            fundToken: fundToken,
            paymentToken: paymentToken,
            executionTime: block.timestamp + 1 hours, // 1 hour delay
            executed: false,
            executor: msg.sender
        });
        
        emit BatchSettlementCreated(batchId, _settlementIds.length, msg.sender);
        
        return batchId;
    }
    
    /**
     * @dev Execute batch settlement
     */
    function executeBatchSettlement(uint256 _batchId) external nonReentrant whenNotPaused {
        BatchSettlement storage batch = batchSettlements[_batchId];
        if (batch.batchId == 0) revert InvalidSettlement();
        if (batch.executed) revert BatchAlreadyExecuted();
        if (block.timestamp < batch.executionTime) revert EscrowNotMatured();
        
        batch.executed = true;
        
        // Execute all settlements in batch
        for (uint256 i = 0; i < batch.settlementIds.length; i++) {
            _completeSettlement(batch.settlementIds[i]);
        }
        
        emit BatchSettlementExecuted(_batchId, block.timestamp);
    }
    
    /**
     * @dev Cancel settlement
     */
    function cancelSettlement(
        uint256 _settlementId,
        string calldata _reason
    ) external whenNotPaused {
        SettlementRecord storage settlement = settlements[_settlementId];
        if (settlement.settlementId == 0) revert InvalidSettlement();
        if (msg.sender != settlement.buyer && 
            msg.sender != settlement.seller && 
            msg.sender != owner()) {
            revert UnauthorizedAccess();
        }
        if (settlement.status == SettlementStatus.Completed) revert InvalidSettlement();
        
        settlement.status = SettlementStatus.Cancelled;
        
        emit SettlementCancelled(_settlementId, _reason);
    }
    
    /**
     * @dev Internal function to complete settlement
     */
    function _completeSettlement(uint256 _settlementId) internal {
        SettlementRecord storage settlement = settlements[_settlementId];
        settlement.status = SettlementStatus.Completed;
        
        emit SettlementCompleted(_settlementId, block.timestamp);
    }
    
    // View Functions
    
    /**
     * @dev Get settlement details
     */
    function getSettlement(uint256 _settlementId) 
        external 
        view 
        returns (SettlementRecord memory) 
    {
        return settlements[_settlementId];
    }
    
    /**
     * @dev Get user settlements
     */
    function getUserSettlements(address _user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return userSettlements[_user];
    }
    
    /**
     * @dev Get escrow details
     */
    function getEscrow(uint256 _escrowId) 
        external 
        view 
        returns (EscrowRecord memory) 
    {
        return escrows[_escrowId];
    }
    
    /**
     * @dev Get batch settlement details
     */
    function getBatchSettlement(uint256 _batchId) 
        external 
        view 
        returns (BatchSettlement memory) 
    {
        return batchSettlements[_batchId];
    }
    
    /**
     * @dev Get escrow balance for user and token
     */
    function getEscrowBalance(address _user, address _token) 
        external 
        view 
        returns (uint256) 
    {
        return escrowBalances[_user][_token];
    }
    
    // Admin Functions
    
    /**
     * @dev Set settlement configuration
     */
    function setSettlementConfig(
        uint256 _escrowPeriod,
        uint256 _disputePeriod,
        uint256 _feeRate,
        uint256 _maxBatchSize
    ) external onlyOwner {
        if (_feeRate > 1000) revert InvalidFeeRate(); // Max 10%
        
        defaultEscrowPeriod = _escrowPeriod;
        disputePeriod = _disputePeriod;
        settlementFeeRate = _feeRate;
        maxBatchSize = _maxBatchSize;
    }
    
    /**
     * @dev Set fee recipient
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }
    
    /**
     * @dev Add/remove authorized resolver
     */
    function setAuthorizedResolver(address _resolver, bool _authorized) external onlyOwner {
        authorizedResolvers[_resolver] = _authorized;
    }
    
    /**
     * @dev Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Emergency withdrawal (only when paused)
     */
    function emergencyWithdraw(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyOwner whenPaused {
        IERC20 token = IERC20(_token);
        if (!token.transfer(_to, _amount)) {
            revert TokenTransferFailed();
        }
    }
}
