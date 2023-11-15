const { expect } = require("chai")
const { loadFixture, setBalance } = require("@nomicfoundation/hardhat-network-helpers")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")

describe("Perpetuals contract", function () {
    async function deployContractFixture() {
        const [deployer, trader1, trader2, trader3] = await ethers.getSigners()

        const token = await ethers.deployContract("USDToken")
        await token.waitForDeployment()
        const tokenAddress = await token.getAddress()

        const pool = await ethers.deployContract("LiquidityPool", [tokenAddress])
        await pool.waitForDeployment()
        const poolAddress = await pool.getAddress()

        const mockFeed = await ethers.deployContract("MockPriceFeed", [8, 1000000000000])
        await mockFeed.waitForDeployment()
        const mockAddress = await mockFeed.getAddress()

        const exchange = await ethers.deployContract("BTCPerpetuals", [tokenAddress, poolAddress, 50, mockAddress])
        await exchange.waitForDeployment()
        const exchangeAddress = await exchange.getAddress()

        const amountTraderTokens = 2000n * 10n ** 18n
        await token.transfer(poolAddress, 100_000n * 10n ** 18n)
        await token.transfer(trader1.address, amountTraderTokens)
        await token.transfer(trader2.address, amountTraderTokens)
        await token.transfer(trader3.address, amountTraderTokens)
        await token.connect(trader1).approve(exchangeAddress, amountTraderTokens)
        await token.connect(trader2).approve(exchangeAddress, amountTraderTokens)
        await token.connect(trader3).approve(exchangeAddress, amountTraderTokens)

        return { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 }
    }

    describe("Testing openPosition", function () {
        it("Should revert with PositionTooLarge error", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await token.transfer(trader1.address, 10000n * 10n ** 18n)

            //try to open a position for 100k with a 10k collateral => PositionTooLarge error - returns maxBorrow amount
            await expect(exchange.connect(trader1).openPosition(100000n * 10n ** 18n, 10000n * 10n ** 18n, 0))
                .to.be.revertedWithCustomError(exchange, "PositionTooLarge")
                .withArgs(50000n * 10n ** 18n)
        })

        it("Should revert with MaxLeverageExceeded error", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            //try to open a position for 16k with a 1k collateral => leverage = 16X
            await expect(exchange.connect(trader1).openPosition(16000n * 10n ** 18n, 1000n * 10n ** 18n, 0))
                .to.be.revertedWithCustomError(exchange, "MaxLeverageExceeded")
                .withArgs(1600, 1500)
        })

        it("Should return correct position values", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            const pos = {
                posType: 0,
                id: 1,
                sizeUSD: 10000n * 10n ** 18n,
                sizeBTC: 10n * 10n ** 7n,
                collateral: 1000n * 10n ** 18n,
            }

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)

            const t1Pos = await exchange.positions(trader1.address)

            expect(t1Pos[0]).to.equal(pos.posType)
            expect(t1Pos[2]).to.equal(pos.id)
            expect(t1Pos[3]).to.equal(pos.sizeUSD)
            expect(t1Pos[4]).to.equal(pos.sizeBTC)
            expect(t1Pos[5]).to.equal(pos.collateral)
        })

        it("Should increase position size", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)
            await exchange.connect(trader1).increasePosition(2000n * 10n ** 18n)

            const t1Pos = await exchange.positions(trader1.address)

            const pos = {
                sizeUSD: 12000n * 10n ** 18n,
                sizeBTC: 12n * 10n ** 7n,
            }

            expect(t1Pos[3]).to.equal(pos.sizeUSD)
            expect(t1Pos[4]).to.equal(pos.sizeBTC)

            expect(await exchange.totalOIBTCAdjusted()).to.equal(12000n * 10n ** 18n) //10k + 2k
            expect(await exchange.totalPoolAssets()).to.equal(101000n * 10n ** 18n) // 100k + 1k collateral
            expect(await exchange.maxBorrowAmount()).to.equal(50500n * 10n ** 18n) // 50% of 101k
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(38500n * 10n ** 18n) // maxBorrow - OI = 50.5k - 12k
        })

        it("Should increase collateral", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)
            await exchange.connect(trader1).increaseCollateral(500n * 10n ** 18n)

            const t1Pos = await exchange.positions(trader1.address)

            expect(t1Pos[5]).to.equal(1500n * 10n ** 18n)
        })

        it("Should decrease exchangePnl, maxAvailableBorrowAmount... for Long position after rising BTC price", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)

            expect(await exchange.totalOIBTCAdjusted()).to.equal(10000n * 10n ** 18n) //10k
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(40500n * 10n ** 18n) // maxBorrow - OI = 50.5k - 10k

            await mockFeed.updateAnswer(20000_000_000_00) //BTC price doubles from 10k to 20k
            await exchange.updatePnL()

            expect(await exchange.totalOIBTCAdjusted()).to.equal(20000n * 10n ** 18n) // 2 * 10k
            expect(await exchange.exchangePnl()).to.equal(-10000n * 10n ** 18n) // -10k : BTC gain
            expect(await exchange.totalPoolAssets()).to.equal(91000n * 10n ** 18n) // 101k - 10k PnL
            expect(await exchange.maxBorrowAmount()).to.equal(45500n * 10n ** 18n)
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(25500n * 10n ** 18n) // maxBorrow - OI = 45.5k - 20k
            expect(await exchange.traderPNL(trader1.address)).to.equal(10000n * 10n ** 18n) // BTC gain

            expect(await exchange.pnlAdjustedTraderCollateral(trader1.address)).to.equal(11000n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader1.address)).to.equal(90) // sizeUSD / adjusted collat => 0.9 X
        })

        it("Should increase exchangePnl, maxAvailableBorrowAmount... for Long position after falling BTC price", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0)

            await mockFeed.updateAnswer(9500_000_000_00) //BTC price falls from 10k to 9.5k
            await exchange.updatePnL()

            expect(await exchange.totalOIBTCAdjusted()).to.equal(9500n * 10n ** 18n) // 10k - 500 loss
            expect(await exchange.exchangePnl()).to.equal(500n * 10n ** 18n) // 500 : BTC loss
            expect(await exchange.totalPoolAssets()).to.equal(101500n * 10n ** 18n) // 101k + 500 PnL
            expect(await exchange.maxBorrowAmount()).to.equal(50750n * 10n ** 18n) // PoolAssets / 2
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(41250n * 10n ** 18n) // maxBorrow - OI
            expect(await exchange.traderPNL(trader1.address)).to.equal(-500n * 10n ** 18n) // BTC loss

            expect(await exchange.pnlAdjustedTraderCollateral(trader1.address)).to.equal(500n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader1.address)).to.equal(2000) // sizeUSD / adjusted collat
        })

        it("Should increase exchangePnl, maxAvailableBorrowAmount... for Short position after rising BTC price", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 1)

            await mockFeed.updateAnswer(10500_000_000_00) //BTC price rises from 10k to 10.5k => 5%
            await exchange.updatePnL()

            expect(await exchange.totalOIBTCAdjusted()).to.equal(10000n * 10n ** 18n) // = Short OI => USD position size
            expect(await exchange.exchangePnl()).to.equal(500n * 10n ** 18n) // 500 : BTC rises => short trader looses
            expect(await exchange.totalPoolAssets()).to.equal(101500n * 10n ** 18n) // 101k + 500 PnL
            expect(await exchange.maxBorrowAmount()).to.equal(50750n * 10n ** 18n) // PoolAssets / 2
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(40750n * 10n ** 18n) // maxBorrow - OI
            expect(await exchange.traderPNL(trader1.address)).to.equal(-500n * 10n ** 18n) // Short loss

            expect(await exchange.pnlAdjustedTraderCollateral(trader1.address)).to.equal(500n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader1.address)).to.equal(2000) // sizeUSD / adjusted collat
        })

        it("Should decrease exchangePnl, maxAvailableBorrowAmount... for Short position after falling BTC price", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 1)

            await mockFeed.updateAnswer(9500_000_000_00) //BTC price falls from 10k to 9.5k => 5%
            await exchange.updatePnL()

            expect(await exchange.totalOIBTCAdjusted()).to.equal(10000n * 10n ** 18n) // = Short OI => USD position size
            expect(await exchange.exchangePnl()).to.equal(-500n * 10n ** 18n) // 500 : BTC falls => trader wins
            expect(await exchange.totalPoolAssets()).to.equal(100500n * 10n ** 18n) // 101k - 500 PnL
            expect(await exchange.maxBorrowAmount()).to.equal(50250n * 10n ** 18n) // PoolAssets / 2
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(40250n * 10n ** 18n) // maxBorrow - OI
            expect(await exchange.traderPNL(trader1.address)).to.equal(500n * 10n ** 18n) // BTC falls => short trader wins

            expect(await exchange.pnlAdjustedTraderCollateral(trader1.address)).to.equal(1500n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader1.address)).to.equal(666) // sizeUSD / adjusted collat
        })

        it("Should returns correct exchange parameters for 2 Long and 1 Short positions", async function () {
            const { token, pool, mockFeed, exchange, deployer, trader1, trader2, trader3 } = await loadFixture(
                deployContractFixture
            )

            await exchange.connect(trader1).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 0) // Long 10k - 1BTC
            await exchange.connect(trader2).openPosition(5000n * 10n ** 18n, 1000n * 10n ** 18n, 0) // Long 5k - 0.5BTC
            await exchange.connect(trader3).openPosition(10000n * 10n ** 18n, 1000n * 10n ** 18n, 1) // Short 10k - 1BTC

            expect(await exchange.totalOIBTCAdjusted()).to.equal(25000n * 10n ** 18n) // 10+10+5
            expect(await exchange.exchangePnl()).to.equal(0)
            expect(await exchange.totalPoolAssets()).to.equal(103000n * 10n ** 18n) // 100+3
            expect(await exchange.maxBorrowAmount()).to.equal(51500n * 10n ** 18n) // PoolAssets / 2
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(26500n * 10n ** 18n) // maxBorrow - OI

            await mockFeed.updateAnswer(10500_000_000_00) //BTC price rices from 10k to 10.5k => 5%
            await exchange.updatePnL()

            expect(await exchange.totalOIBTCAdjusted()).to.equal(25750n * 10n ** 18n) // 25k + 500 gain + 250 gain
            expect(await exchange.exchangePnl()).to.equal(-250n * 10n ** 18n) // T1 is 500 in profit, T2 250 in profit, T3 is 500 in loss
            expect(await exchange.totalPoolAssets()).to.equal(102750n * 10n ** 18n) // 103k - 250 PnL
            expect(await exchange.maxBorrowAmount()).to.equal(51375n * 10n ** 18n) // PoolAssets / 2
            expect(await exchange.maxAvailableBorrowAmount()).to.equal(25625n * 10n ** 18n) // maxBorrow - OI

            expect(await exchange.traderPNL(trader1.address)).to.equal(500n * 10n ** 18n) // 500 profit
            expect(await exchange.pnlAdjustedTraderCollateral(trader1.address)).to.equal(1500n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader1.address)).to.equal(666) // sizeUSD / adjusted collat

            expect(await exchange.traderPNL(trader2.address)).to.equal(250n * 10n ** 18n)
            expect(await exchange.pnlAdjustedTraderCollateral(trader2.address)).to.equal(1250n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader2.address)).to.equal(400) // sizeUSD / adjusted collat

            expect(await exchange.traderPNL(trader3.address)).to.equal(-500n * 10n ** 18n) // BTC falls => short trader wins
            expect(await exchange.pnlAdjustedTraderCollateral(trader3.address)).to.equal(500n * 10n ** 18n) // collat + trader PnL
            expect(await exchange.pnlAdjustedTraderLeverage(trader3.address)).to.equal(2000) // sizeUSD / adjusted collat
        })
    })
})
