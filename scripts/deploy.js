//Sepolia: https://sepolia.etherscan.io/address/0x92048a6b661cFDB8097b2b98991C3969C8eF056f#code

//token: 0x658164BA4743d650560AFE4B032e5Bae006BD6eF
//pool: 0xf8dfa438BDB78E21aa9191b033eb3163311CB308
//exchange: 0x92048a6b661cFDB8097b2b98991C3969C8eF056f

const { PK_TRADER1, PK_TRADER2 } = process.env

async function main() {
    let provider, txn, txnReceipt

    //const [deployer, trader1, trader2] = await ethers.getSigners()

    provider = ethers.provider
    const trader1 = new ethers.Wallet(PK_TRADER1, provider)
    const trader2 = new ethers.Wallet(PK_TRADER2, provider)

    const token = await ethers.deployContract("USDToken")
    await token.waitForDeployment()
    console.log("Token deployed to:", token.target)

    const pool = await ethers.deployContract("LiquidityPool", [token.target])
    await pool.waitForDeployment()
    console.log("Pool deployed to:", pool.target)

    // const mockFeed = await ethers.deployContract("MockPriceFeed", [8, 1000000000000])
    // await mockFeed.waitForDeployment()

    const priceFeedAddress = "0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43" // BTC/USD Sepolia : 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43  ---  mockFeed.target
    const exchange = await ethers.deployContract("BTCPerpetuals", [token.target, pool.target, 50, priceFeedAddress])
    await exchange.waitForDeployment()
    console.log("Exchange deployed to:", exchange.target)

    const amountTraderTokens = 2000n * 10n ** 18n
    txn = await token.transfer(pool.target, 100_000n * 10n ** 18n)
    await txn.wait()
    txn = await token.transfer(trader1.address, amountTraderTokens)
    await txn.wait()
    txn = await token.transfer(trader2.address, amountTraderTokens)
    await txn.wait()
    txn = await token.connect(trader1).approve(exchange.target, amountTraderTokens)
    await txn.wait()
    txn = await token.connect(trader2).approve(exchange.target, amountTraderTokens)
    await txn.wait()

    //Long position 10k with 1k collateral
    txn = await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)
    await txn.wait()

    //Short position 5k with 1k collateral
    txn = await exchange.connect(trader2).openPosition(5000n * 10n ** 18n, 1000n * 10n ** 18n, 1)
    await txn.wait()

    const t1Pos = await exchange.positions(trader1.address)

    console.log(t1Pos[3]) //sizeUSD
    console.log(t1Pos[4]) //sizeBTC
    console.log(t1Pos[5]) //collateral
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})

//npx hardhat verify --network sepolia 0x92048a6b661cFDB8097b2b98991C3969C8eF056f "0x658164BA4743d650560AFE4B032e5Bae006BD6eF" "0xf8dfa438BDB78E21aa9191b033eb3163311CB308" "50" "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43"
