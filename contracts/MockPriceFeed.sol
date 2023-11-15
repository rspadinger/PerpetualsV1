// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";

contract MockPriceFeed is MockV3Aggregator {
    constructor(uint8 decimals, int256 testValue) MockV3Aggregator(decimals, testValue) {}
}