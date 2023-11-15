// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

interface IBTCPerpetuals {
    function maxWithdrawAmount() external view returns (uint256);
}

contract LiquidityPool is Ownable, ERC4626 {

    address public exchange;

    constructor(address _asset) Ownable(msg.sender) ERC4626(IERC20(_asset)) ERC20("LPShares", "LPS") {
    }

    function setExchangeAddress(address _exchange) public onlyOwner {
        exchange = _exchange;
    }    
    
    //we keep the totalAssets() function as it is => 
    //the number of shares issued for LP's should not take into account the current (unrealized) exchange PnL
    // function totalAssets() public view override returns (uint256) {
    //     return totalAssets() + currentExchangePnl();
    // }

    //override maxWithraw => a minimum of reserves must remain available to payout traders 
    function maxWithdraw(address lp) public view override returns (uint256) {
        uint256 maxAmount = type(uint256).max;
        uint256 maxAmountForUser = _convertToAssets(balanceOf(lp), Math.Rounding.Floor);        

        if(exchange != address(0)) {
            maxAmount = IBTCPerpetuals(exchange).maxWithdrawAmount();
        }

        //return the smaller amount
        if(maxAmount > maxAmountForUser)
            return maxAmountForUser;
        else 
            return maxAmount;
    }  
}
