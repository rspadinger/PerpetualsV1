// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDToken is ERC20 {
    constructor() ERC20("USD-Perpetual", "USDP") {
        _mint(msg.sender, type(uint256).max);
    }
}
