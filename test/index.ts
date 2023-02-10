import { Contract } from "ethers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import ERC20Abi from "./abi/ERC20.json";

describe("Start liquidity program on sushiswap", async () => {
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let impersonatedSignerDAI: SignerWithAddress;
  let impersonatedSignerWETH: SignerWithAddress;
  let sushi: Contract;
  let dai: Contract;
  let weth: Contract;

  const impersonatedAccountDAI = "0x16B34Ce9A6a6F7FC2DD25Ba59bf7308E7B38E186";
  const impersonatedAccountWETH = "0x0C4809bE72F9E117D75381438c5dAeC8AbE75BaD";
  const DAIAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const USDTAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const provider = await network.provider;

  beforeEach(async () => {
    [user1, user2] = await ethers.getSigners();
    const Sushi = await ethers.getContractFactory("Sushi");
    sushi = await Sushi.deploy();
    await sushi.deployed();

    dai = await ethers.getContractAt(ERC20Abi, DAIAddress);
    weth = await ethers.getContractAt(ERC20Abi, USDTAddress);

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccountDAI],
    });

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccountWETH],
    });

    impersonatedSignerDAI = await ethers.getSigner(impersonatedAccountDAI);
    impersonatedSignerWETH = await ethers.getSigner(impersonatedAccountWETH);

    await dai.connect(impersonatedSignerDAI).transfer(user1.address, 50000);
    await weth.connect(impersonatedSignerWETH).transfer(user1.address, 100);
    await dai.connect(user1).approve(sushi.address, 50000);
    await weth.connect(user1).approve(sushi.address, 100);

    await dai.connect(impersonatedSignerDAI).transfer(user2.address, 100000);
    await weth.connect(impersonatedSignerWETH).transfer(user2.address, 15000);
    await dai.connect(user2).approve(sushi.address, 100000);
    await weth.connect(user2).approve(sushi.address, 15000);
  });

  describe("Add liquidity", () => {
    it("Check the token address", async () => {
      await expect(
        sushi.connect(user1).addLiquidity(dai.address, ethers.constants.AddressZero, 50000, 100),
      ).to.be.revertedWith("evan407 token address must be given");
      await expect(
        sushi.connect(user1).addLiquidity(ethers.constants.AddressZero, weth.address, 100000, 15000),
      ).to.be.revertedWith("evan407 token address must be given");
    });

    it("Check deposit token amount", async () => {
      await expect(sushi.connect(user1).addLiquidity(dai.address, weth.address, 0, 100)).to.be.revertedWith(
        "evan407 token amount must be bigger than 0",
      );

      await expect(sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 0)).to.be.revertedWith(
        "evan407 token amount must be bigger than 0",
      );
    });

    it("Check lp token amount", async () => {
      const beforeBalance = await sushi.balanceOfPool();

      await sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 100);

      const afterBalance = await sushi.balanceOfPool();
      expect(afterBalance - beforeBalance).to.greaterThan(0);
    });
  });

  describe("Harvest", () => {
    it("Check harvestable", async () => {
      await sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 100);
      await sushi.connect(user2).addLiquidity(dai.address, weth.address, 100000, 15000);

      mine(100000);

      expect(parseInt(await sushi.connect(user1).getHarvestable())).to.greaterThan(0);
    });
  });

  describe("Claim", () => {
    it("Check claiming", async () => {
      await sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 100);
      await sushi.connect(user2).addLiquidity(dai.address, weth.address, 100000, 15000);

      mine(100000);

      await sushi.connect(user1).claim();
      await sushi.connect(user2).claim();

      const user1Sushi = await sushi.balanceOfSushi(user1.address);
      const user2Sushi = await sushi.balanceOfSushi(user2.address);

      expect(parseInt(user2Sushi) - parseInt(user1Sushi)).to.greaterThan(0);
    });
  });

  describe("Withdraw", () => {
    it("Check withdraw amount", async () => {
      await sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 100);
      await sushi.connect(user2).addLiquidity(dai.address, weth.address, 100000, 15000);

      mine(100000);

      await sushi.connect(user1).claim();
      await sushi.connect(user2).claim();

      await expect(sushi.connect(user1).withdraw(5000)).to.be.revertedWith(
        "evan407 withdraw amount must be smaller than total amount",
      );
    });

    it("Check withdrawing", async () => {
      const withdrawAmount = 1000;
      await sushi.connect(user2).addLiquidity(dai.address, weth.address, 100000, 15000);

      mine(100000);

      await sushi.connect(user2).claim();
      const beforeBalance = await sushi.balanceOfPool();

      await sushi.connect(user2).withdraw(withdrawAmount);

      const sushiAmount1 = await sushi.balanceOfSushi(user2.address);

      mine(100000);
      await sushi.connect(user2).claim();
      const sushiAmount2 = await sushi.balanceOfSushi(user2.address);
      const afterBalance = await sushi.balanceOfPool();

      console.log("First sushi amount: ", parseInt(sushiAmount1));
      console.log("After withdrawing, sushi amount: ", parseInt(sushiAmount2));
      expect(beforeBalance - afterBalance).to.be.equal(withdrawAmount);
    });
  });

  describe("Remove Liquidity", () => {
    it("Check removeLiquidity", async () => {
      await sushi.connect(user1).addLiquidity(dai.address, weth.address, 50000, 100);
      await sushi.connect(user1).removeLiquidity(dai.address, weth.address);
    });
  });
});
