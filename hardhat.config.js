require("@nomicfoundation/hardhat-toolbox")
require("dotenv").config()

const { ALCHEMY_API_URL, PK_TRADER1, ETHERSCAN_API_KEY } = process.env

module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: { enabled: true, runs: 200 },
        },
    },
    defaultNetwork: "localhost",
    networks: {
        sepolia: {
            url: ALCHEMY_API_URL,
            accounts: [`0x${PK_TRADER1}`],
        },
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
    },
}
