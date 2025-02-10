import { TestPool, makeTokenPool, Token, makeEtherPool, POOL_IDX, ERC20Token, makeStandaloneToken, makeTokenTriangle } from './FacadePool'
import { expect } from "chai";
import "@nomiclabs/hardhat-ethers";
import hardhat, { ethers } from 'hardhat';
import { toSqrtPrice, fromSqrtPrice, maxSqrtPrice, minSqrtPrice, ZERO_ADDR, MAX_PRICE, MIN_PRICE } from './FixedPoint';
import { solidity } from "ethereum-waffle";
import chai from "chai";
import { MockERC20 } from '../typechain/MockERC20';
import { BigNumber, BigNumberish, ContractFactory, ContractTransaction, Signer } from 'ethers';
import { HotProxy, AltheaDexContinuousMultiTokenIncentives } from '../typechain';
import {mine} from 'viem/_types/actions/test/mine';

chai.use(solidity);

describe('FeeTracking', () => {
    let test1: TestPool
    let test2: TestPool
    let test3: TestPool
    let baseToken: ERC20Token
    let quoteToken: ERC20Token
    let rewardToken: ERC20Token
    const feeRate = 50000
    let incentives : AltheaDexContinuousMultiTokenIncentives
    let baseQuotePoolId: string

    beforeEach("deploy",  async () => {
        [test1, test2, test3] = await makeTokenTriangle()
        baseToken = await test1.base
        quoteToken = await test1.quote
        rewardToken = await makeStandaloneToken();

        test1.useHotPath = true;
        test2.useHotPath = true;
        await test1.initPool(feeRate, 0, 1, 1)
        await test2.initPool(feeRate, 0, 1, 1)
 
        await test1.base.contract.deposit(await (await test1.trader).getAddress(), ethers.utils.parseEther("1000000"))
        await test1.quote.contract.deposit(await (await test1.trader).getAddress(), ethers.utils.parseEther("1000000"))
        await test1.base.approve(await test1.trader, (await test1.dex).address, ethers.utils.parseEther("1000000"))
        await test1.quote.approve(await test1.trader, (await test1.dex).address, ethers.utils.parseEther("1000000"))
        await test2.base.approve(await test1.trader, (await test1.dex).address, ethers.utils.parseEther("1000000"))
        await test2.quote.approve(await test1.trader, (await test1.dex).address, ethers.utils.parseEther("1000000"))


        let incentivesFactory = await ethers.getContractFactory("AltheaDexContinuousMultiTokenIncentives") as ContractFactory;
        incentives = await incentivesFactory.deploy((await test1.dex).address, ZERO_ADDR, [], [], [], []) as AltheaDexContinuousMultiTokenIncentives;
 
        baseQuotePoolId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "uint256"],
                [baseToken.address, quoteToken.address, POOL_IDX]
            )
        );
    })

    it("pool and user fee accumulators are updated on swap and harvest", async () => {
        let liqAmbient = ethers.utils.parseEther("10000000");
        let liqConcentrated = ethers.utils.parseEther("20000");

        test1.base.contract.deposit(await (await test1.trader).getAddress(), liqAmbient.add(liqConcentrated).mul(ethers.utils.parseEther("1024")))
        test1.quote.contract.deposit(await (await test1.trader).getAddress(), liqAmbient.add(liqConcentrated).mul(ethers.utils.parseEther("1024")))
        test1.base.approve(await test1.trader, (await test1.dex).address, liqAmbient.add(liqConcentrated).mul(ethers.utils.parseEther("1024")))
        test1.quote.approve(await test1.trader, (await test1.dex).address, liqAmbient.add(liqConcentrated).mul(ethers.utils.parseEther("1024")))

        // Mint a concentrated position
        await test1.testMint(-5000, 5000, liqConcentrated);
        liqConcentrated = liqConcentrated.mul(1024); // Update value for future use

        const rateNum = ethers.utils.parseEther("1"); // 1 token
        const rateDen = ethers.utils.parseEther("10240"); // Every 10 blocks, every 1024 * 10^18 liquidity units

        await incentives.createOrModifyAmbientRewardsProgram(
            baseQuotePoolId, 
            rewardToken.address, 
            rateNum,  
            rateDen, 
        );

        await incentives.registerForAmbientRewards(baseQuotePoolId, rewardToken.address);

        // Execute a swap on the pool
        await test1.testSwapB(false, true, ethers.utils.parseEther("1"), BigNumber.from(Math.round(2000000000001 * 2^64)));

        // Check that the pool's incentive fee tracker value is updated correctly
        const poolFeeAccumulator = await (await test1.dex).incentivePoolFeeAccumulators(baseQuotePoolId);
        expect(poolFeeAccumulator).to.be.gt(0);

        // Execute a harvest
        await test1.testHarvest(-5000, 5000);

        const traderAddress = await (await test1.trader).getAddress();

        // Check that the user's incentive fee tracker for the pool is updated correctly
        const userFeeAccumulator = await (await test1.dex).incentiveUserPoolFeeAccumulators(traderAddress, baseQuotePoolId);
        // expect(userFeeAccumulator).to.be.gt(0);

        // Execute another swap on the pool
        for (let i = 0; i < 10; i++) {
            await testSwap(test1, await test1.trader, true, true, ethers.utils.parseEther("100000"), MAX_PRICE);
            await testSwap(test1, await test1.trader, false, true, ethers.utils.parseEther("100000"), MIN_PRICE);
        }


        await test1.testMintAmbient(ethers.utils.parseEther("100"));
        // Burn the concentrated position
        await test1.testBurnB(-5000, 5000, liqConcentrated.div(1024));

        // Check that the user's incentive fee tracker for the pool is updated correctly after the burn
        const updatedUserFeeAccumulator = await (await test1.dex).incentiveUserPoolFeeAccumulators(traderAddress, baseQuotePoolId);
        expect(updatedUserFeeAccumulator).to.be.gt(0);
    });
})

async function testSwap(test: TestPool, from: Signer, isBuy: boolean, inBaseQty: boolean, qty: BigNumberish, price: BigNumber,
        useSurplus: number = 0): Promise<ContractTransaction> {
    let slippage = (inBaseQty == isBuy ? BigNumber.from(0) : BigNumber.from(2).pow(126));

    return (await test.dex).connect(from).swap((await test.base).address, (await test.quote).address, 
        test.poolIdx, isBuy, inBaseQty, qty, 0, price, slippage, useSurplus, test.overrides)
}
