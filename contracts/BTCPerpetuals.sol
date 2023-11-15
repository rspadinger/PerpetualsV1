// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "hardhat/console.sol";

contract BTCPerpetuals is Ownable {

    enum PositionType {LONG, SHORT}

    uint256 private constant MAX_LEVERAGE = 1500; // store with 2 decimals
    uint256 private constant BTC_MULTIPLICATOR = 10 ** 8;
    uint256 private constant CHAINLINK_PRICE_MULTIPLICATOR = 10 ** 10;
    uint256 private constant LEVERAGE_MULTIPLICATOR = 10 ** 2;

    uint256 private immutable maxBorrowPercentage;

    uint256 public numberOfPositions;

    uint256 public totalOILongUSD;
    uint256 public totalOIShortUSD;

    //BTC amounts are stored with a multiplicator of 10 ** 8
    uint256 public totalOILongBTC;
    uint256 public totalOIShortBTC;

    int256 public exchangePnl;

    IERC20 public collateralToken;
    IERC4626 public pool;
    AggregatorV3Interface public priceFeed;

    struct Position {
        PositionType posType;
        uint256 createdAt;
        uint256 id;
        uint256 sizeUSD;
        uint256 sizeBTC;
        uint256 collateral;
    }

    //for this simple demo, each address can have only 1 open BTC position, that can be increased
    mapping(address => Position) public positions;

    error CollateralTransferFailed();
    error UnsupportedPositionType(PositionType posType);
    error PositionTooLarge(uint256 maxPosSize);
    error SizeIsZero();
    error CollateralIsZero();
    error InsufficientCollateral();
    error InsufficientPoolFunds();
    error LeverageIsZero();
    error MaxLeverageExceeded(uint256 currentLeverage, uint256 maxLeverage);
    error UserAlreadyOpenedAPosition(uint256 positionId);
    error NoPositionHasBeenOpenedYet();

    event PositionOpened(address indexed trader, uint256 sizeUSD, uint256 sizeBTC, uint256 createdAt);
    event CollateralAdded(address indexed trader, uint256 collateral, uint256 addedAt);
    event PositionIncreased(address indexed trader, uint256 sizeUSD, uint256 addedAt);

    modifier PositionExists(bool exists) {
        uint256 createdAt = positions[msg.sender].createdAt;

        if(exists) {
            if(createdAt == 0)
            revert NoPositionHasBeenOpenedYet();
        } else {
            if(createdAt != 0)
            revert UserAlreadyOpenedAPosition(positions[msg.sender].id);
        }
        _;  
    }

    modifier CheckPoolFunds(uint256 sizeUSD) {
        uint256 maxAmount = maxAvailableBorrowAmount();
        if(maxAmount == 0)
            revert InsufficientPoolFunds();

        if(sizeUSD > maxAmount)
            revert PositionTooLarge(maxAmount);
        _;
    }

    modifier CheckPositionSize(uint256 sizeUSD) {
        if(sizeUSD == 0)
            revert SizeIsZero();
        _;
    }

    modifier CheckCollateral(uint256 collateral) {
        if(collateral == 0)
            revert CollateralIsZero();
        _;
    }

    constructor(address _collateralAddress, address _poolAddress, uint8 _maxBorrowPercentage, address _priceFeed) 
        Ownable(msg.sender) 
    {
        collateralToken = IERC20(_collateralAddress);
        pool = IERC4626(_poolAddress);
        maxBorrowPercentage = _maxBorrowPercentage;
        priceFeed = AggregatorV3Interface(_priceFeed);
    }
    
    //when calling this function, don't forget to specify sizeUSD & collateral (USD token falue) in wei ( * 10 ** 18)
    function openPosition(uint256 sizeUSD, uint256 collateral, PositionType posType)
        public 
        CheckPositionSize(sizeUSD)
        CheckCollateral(collateral)
        PositionExists(false) 
        CheckPoolFunds(sizeUSD)         
    {
        if(posType != PositionType.LONG && posType != PositionType.SHORT)
            revert UnsupportedPositionType(posType);         
        
        uint256 leverage = getLeverage(sizeUSD, collateral);

        if(leverage > MAX_LEVERAGE)
            revert MaxLeverageExceeded(leverage, MAX_LEVERAGE);        
        
        uint256 createdAt = block.timestamp;

        //the amount of BTC multiplied by 10**8
        uint256 sizeBTC = getBTCFromUSDPosition(sizeUSD); 

        //transfer collateral to the pool - trader must have approved before
        bool success = collateralToken.transferFrom(msg.sender, address(pool), collateral);
        
        if(!success)
            revert CollateralTransferFailed();
        
        numberOfPositions++;

        //create the position
        Position storage pos = positions[msg.sender];
        pos.posType = posType;       
        pos.createdAt = createdAt;
        pos.id = numberOfPositions; 
        pos.sizeUSD = sizeUSD;
        pos.sizeBTC = sizeBTC;
        pos.collateral = collateral;  

        adjustOpenInterest(posType, sizeUSD, sizeBTC);            

        emit PositionOpened(msg.sender, sizeUSD, sizeBTC, createdAt);  
    }

    //if the trader needs additional collateral, he first needs to call "increaseCollateral"
    function increasePosition(uint256 addedSize) 
        public 
        CheckPositionSize(addedSize)
        PositionExists(true) 
        CheckPoolFunds(addedSize) 
    {        
        Position storage pos = positions[msg.sender]; 
        uint256 newSizeUSD = pos.sizeUSD + addedSize; 
        uint256 newLeverage = getLeverage(newSizeUSD, pos.collateral); 

        if(newLeverage > MAX_LEVERAGE)
            revert MaxLeverageExceeded(newLeverage, MAX_LEVERAGE);           
        
        //the amount of BTC multiplied by 10**8
        uint256 addedBTC = getBTCFromUSDPosition(addedSize);
        uint256 newSizeBTC = pos.sizeBTC + addedBTC;
         
        pos.sizeUSD = newSizeUSD;
        pos.sizeBTC = newSizeBTC; 

        adjustOpenInterest(pos.posType, addedSize, addedBTC);           

        emit PositionIncreased(msg.sender, addedSize, block.timestamp); 
    }

    //in this simple demo, we assume a trader can only have 1 open position =>
    //we can access the position data via positions[msg.sender]
    function increaseCollateral(uint256 addedCollateral) 
        public 
        CheckCollateral(addedCollateral)
        PositionExists(true) 
    {
        bool success = collateralToken.transferFrom(msg.sender, address(pool), addedCollateral);
        if(!success)
            revert CollateralTransferFailed();

        Position storage pos = positions[msg.sender];
        pos.collateral += addedCollateral; 

        emit CollateralAdded(msg.sender, addedCollateral, block.timestamp); 
    }

    //register upkeep with time-based trigger: https://automation.chain.link/new-time-based
    function updatePnL() public {
        uint256 btcQuote = getBTCQuote();        
        int256 longPnl = int256(totalOILongUSD) - int256( ( totalOILongBTC * btcQuote ) / BTC_MULTIPLICATOR );
        int256 shortPnl = int(( totalOIShortBTC * btcQuote ) / BTC_MULTIPLICATOR ) - int(totalOIShortUSD);

        exchangePnl = longPnl + shortPnl;
    }

    function totalOIUSD() public view returns (uint256) {
        return totalOILongUSD + totalOIShortUSD;
    }

    function totalOIBTC() public view returns (uint256) {
        return totalOILongBTC + totalOIShortBTC;
    }
  
    //returns a USD representation of the total OI in wei => used to calculate maxBorrow & maxWithdraw amount
    //we need to just the LongOI to the current token price
    //(shortOpenInterest) + (longOIBTC * currentBTCPrice) < (depositedLiquidity * maxUtilizationPercentage)
    function totalOIBTCAdjusted() public view returns (uint256) {
        //careful, we want to return a value represented in wei (10**18)
        //totalOIShortUSD is already in wei
        //getBTCQuote() also returns a USD value in wei
        //however, the totalOILongBTC value is stored with a multiplicator of 10**8 =>
        //so, we need to divide the value (after multiplication with the quote value) by that factor
        return ((totalOILongBTC * getBTCQuote()) / BTC_MULTIPLICATOR) + totalOIShortUSD;
    }

    function totalPoolAssets() public view returns (uint256) {
        //return the total pool assets & take into account the current exchangePnL,
        //in order to ajust the max borrow rate accordingly
        uint256 totalAssets = pool.totalAssets();

        if( (exchangePnl * -1) > int(totalAssets))
            return 0;
        else {
            if(exchangePnl < 0) {
                uint256 loss = uint256(exchangePnl * -1);
                return totalAssets - loss;
            } else {
                return totalAssets + uint(exchangePnl);
            }
        }
    }

    function maxBorrowAmount() public view returns (uint256) {
        return (maxBorrowPercentage * totalPoolAssets()) / 100;
    }    

    function maxAvailableBorrowAmount() public  view returns (uint256) {
        uint256 maxAmount = maxBorrowAmount();
        uint256 totalOI = totalOIBTCAdjusted();

        if(totalOI >= maxAmount)
            return 0;

        return maxAmount - totalOI;
    }

    function traderPNL(address trader) public view returns (int256 pnl) {
        Position memory pos = positions[trader];
        if(pos.createdAt == 0)
            return 0;

        uint256 btcQuote = getBTCQuote();
        
        uint256 sizeBTC = pos.sizeBTC;
        uint256 sizeUSD = pos.sizeUSD;

        int256 currentMarketValue = int(btcQuote);        
        int256 originalBTCPrice = int((sizeUSD * BTC_MULTIPLICATOR) / sizeBTC);
        int256 priceDifference;

        if(pos.posType == PositionType.LONG) {
            //pnl = (currentMarketValue - positionBuyValue) * numberTokensBought 
            priceDifference = currentMarketValue - originalBTCPrice; 
        } else {
            //pnl = (positionBuyValue - currentMarketValue) * numberTokensBought
            priceDifference = originalBTCPrice - currentMarketValue;
        }

        pnl = ( priceDifference * int(sizeBTC) ) / int256(BTC_MULTIPLICATOR);
    }

    function pnlAdjustedTraderCollateral(address trader) public view returns (uint256 adjustedCollateral) {        
        Position memory pos = positions[trader];
        if(int256(pos.collateral) + traderPNL(trader) < 0)
            return 0;
        else 
            return uint256(int256(pos.collateral) + traderPNL(trader));
    }

    function pnlAdjustedTraderLeverage(address trader) public view returns (uint256 adjustedLeverage) { 
        uint256 adjustedCollateral = pnlAdjustedTraderCollateral(trader); 

        if(adjustedCollateral == 0) 
            return 0;
            
        return getLeverage(positions[trader].sizeUSD, adjustedCollateral);        
    }

    function maxWithdrawAmount() external view returns (uint256) {
        uint256 totalAssets = pool.totalAssets();
        uint256 totalOIPercentage = ( totalOIBTCAdjusted() * 100 ) / maxBorrowPercentage;
        if(totalOIPercentage > totalAssets)
            return 0;
        else
            return totalAssets - totalOIPercentage;
    }

    function getBTCFromUSDPosition(uint256 sizeUSD) private view returns (uint256) {
        return ( sizeUSD * BTC_MULTIPLICATOR ) / getBTCQuote();
    }

    function getLeverage(uint256 sizeUSD, uint256 collateral) private pure returns (uint256) {
        return (sizeUSD * LEVERAGE_MULTIPLICATOR) / collateral;
    }

    function adjustOpenInterest(PositionType posType, uint256 sizeUSD, uint256 sizeBTC) private {
        if(posType == PositionType.LONG) {
            totalOILongUSD+=sizeUSD;
            totalOILongBTC+=sizeBTC;
        } else {
            totalOIShortUSD+=sizeUSD;
            totalOIShortBTC+=sizeBTC;
        } 

        updatePnL(); 
    }

    // https://docs.chain.link/data-feeds/price-feeds/addresses/?network=ethereum&page=1
    // BTC/USD Sepolia address: 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
    // BTC/USD feed returns 8 decimals 
    function getBTCQuote() internal view returns (uint256) {
        // to get the wei representation (10**18), we still need to multiply with 10**10
        (
            /*uint80 roundID*/,
            int price,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = priceFeed.latestRoundData();

        return uint(price) * CHAINLINK_PRICE_MULTIPLICATOR;
        //return 2000000000000 * CHAINLINK_PRICE_MULTIPLICATOR; //20k in wei
    }
    
}
