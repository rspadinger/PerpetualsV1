# Perpetuals Demo V1

This is the first project for the Gateway Web3 security Course: Mission #1 - Perpetuals

All details can be found at: https://guardianaudits.notion.site/Mission-1-Perpetuals-028ca44faa264d679d6789d5461cfb13

This is a very basic demo of a perpetuals exchange. For mission #1, features like: decreasing, closing, liquidating positions, implementing fees, handling profits or losses... have nnot been implemented.

Also, proper Natspec documentaion has not been used in the Solidity code and the unit/integration tests are very basic with a relatively low test coverage.

The project has been deployed to Sepolia and the main exchange contract is located at: https://sepolia.etherscan.io/address/0x92048a6b661cFDB8097b2b98991C3969C8eF056f#code

For the BTC/USD price feed, a Chainlink upkeep is used that updates the price every 6 hours.

## Dependencies

Install the following tools:

-   Node.js & NPM: https://nodejs.org
-   Hardhat: https://hardhat.org/hardhat-runner/docs/getting-started
-   Metamask: https://metamask.io/download/

Optionally, create an account on Alchemy:

-   Alchemy (third party node provider): https://auth.alchemyapi.io/signup

## Step 1. Clone the project

`git clone https://github.com/rspadinger/Perpetuals-V1.git`

## Step 2. Install dependencies

```
`$ cd project_folder` => (replace project_folder with the name of the folder where the downloaded project files are located )
`$ npm install`
```

## Step 3. Start a local blockchain

Either start Ganache or the local blockchain provided by Hardhat.

To run a local Hardhat node, open a command window, select a directory where Hardhat is installed (cd myHardhatFolder...) and run the command:

`$ npx hardhat node`

## Step 4. Create a .env file

Here are the required environment variables:

ALCHEMY_API_URL="https://eth-sepolia.g.alchemy.com/v2/REPLACE_WITH_YOUR_API_KEY"
PK_TRADER1="YOUR PRIVATE KEY FROM A METAMASK ACCOUNT"
PK_TRADER2="YOUR PRIVATE KEY FROM A SECOND METAMASK ACCOUNT"
ETHERSCAN_API_KEY="YOUR_ETHERSCAN_KEY"

## Step 5. Deploy the Smart Contract

The deployment script is located at: scripts/deploy.js

-   To deploy the SC to a local blockchain, open a command window and type: `$npx hardhat run scripts/deploy.js`
-   To deploy the SC to a remote blockchain (for example: sepolia), open a command window and type: npx hardhat run `$scripts/deploy.js --network sepolia`
