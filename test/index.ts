import { Contract } from "ethers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import ERC20Abi from "./abi/ERC20.json";

describe("Start liquidity program on sushiswap", async () => {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let impersonatedSignerDAI: SignerWithAddress;
  let impersonatedSignerWETH: SignerWithAddress;
  let impersonatedSignerCVX: SignerWithAddress;
  let sushi: Contract;
  let dai: Contract;
  let weth: Contract;
  let cvx: Contract;

  const impersonatedAccountDAI = "0x16B34Ce9A6a6F7FC2DD25Ba59bf7308E7B38E186";
  const impersonatedAccountWETH = "0x0C4809bE72F9E117D75381438c5dAeC8AbE75BaD";
  const impersonatedAccountCVX = "0x945BCF562085De2D5875b9E2012ed5Fd5cfaB927";
  const DAIAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const WETHAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const CVXAddress = "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b";
  const provider = await network.provider;

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    const Sushi = await ethers.getContractFactory("Sushi");
    sushi = await Sushi.deploy();
    await sushi.deployed();

    dai = await ethers.getContractAt(ERC20Abi, DAIAddress);
    weth = await ethers.getContractAt(ERC20Abi, WETHAddress);
    cvx = await ethers.getContractAt(ERC20Abi, CVXAddress);

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccountDAI],
    });

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccountWETH],
    });

    await provider.request({
      method: "hardhat_impersonateAccount",
      params: [impersonatedAccountCVX],
    });

    impersonatedSignerDAI = await ethers.getSigner(impersonatedAccountDAI);
    impersonatedSignerWETH = await ethers.getSigner(impersonatedAccountWETH);
    impersonatedSignerCVX = await ethers.getSigner(impersonatedAccountCVX);

    await dai.connect(impersonatedSignerDAI).transfer(alice.address, 50000);
    await weth.connect(impersonatedSignerWETH).transfer(alice.address, 100);
    await cvx.connect(impersonatedSignerCVX).transfer(alice.address, 10000);
    await dai.connect(alice).approve(sushi.address, 50000);
    await weth.connect(alice).approve(sushi.address, 100);
    await cvx.connect(alice).approve(sushi.address, 10000);

    await dai.connect(impersonatedSignerDAI).transfer(bob.address, 100000);
    await weth.connect(impersonatedSignerWETH).transfer(bob.address, 15000);
    await dai.connect(bob).approve(sushi.address, 100000);
    await weth.connect(bob).approve(sushi.address, 15000);
  });

  describe("MasterChef V1", () => {
    const poolId = 2;
    const version = 1;

    describe("Add liquidity", () => {
      it("Check the owner", async () => {
        await expect(
          sushi.connect(bob).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version),
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Check the token address", async () => {
        await expect(
          sushi.connect(alice).addLiquidity(dai.address, ethers.constants.AddressZero, 50000, 100, poolId, version),
        ).to.be.revertedWith("evan407: token address must be given");
        await expect(
          sushi.connect(alice).addLiquidity(ethers.constants.AddressZero, weth.address, 100000, 15000, poolId, version),
        ).to.be.revertedWith("evan407: token address must be given");
      });

      it("Check deposit token amount", async () => {
        await expect(
          sushi.connect(alice).addLiquidity(dai.address, weth.address, 0, 100, poolId, version),
        ).to.be.revertedWith("evan407: token amount must be bigger than 0");

        await expect(
          sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 0, poolId, version),
        ).to.be.revertedWith("evan407: token amount must be bigger than 0");
      });

      it("Check lp token amount", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);
        await expect(parseInt(lpAmount)).to.greaterThan(0);
      });
    });

    describe("Claim", () => {
      it("Check claiming", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);
        const beforeBalance = await sushi.balanceOfSushi(alice.address);
        await sushi.connect(alice).harvest(poolId, version);
        const afterBalance = await sushi.balanceOfSushi(alice.address);

        expect(afterBalance - beforeBalance).to.greaterThan(0);
      });

      it("Check the owner", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);

        await expect(sushi.connect(bob).harvest(poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });

    describe("Withdraw", () => {
      it("Check withdraw amount", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);

        await expect(sushi.connect(alice).withdraw(5000, poolId, version)).to.be.revertedWith(
          "evan407: withdraw amount must be smaller than total amount",
        );
      });

      it("Check the owner", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);

        await expect(sushi.connect(bob).withdraw(5000, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });

      it("Check withdrawing", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);
        const before = await sushi.connect(alice).balanceOfPool(poolId, version);
        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);
        const balance = await sushi.balanceOfSushi(alice.address);
        expect(balance).to.greaterThan(0);

        await sushi.connect(alice).withdraw(500, poolId, version);
        const after = await sushi.connect(alice).balanceOfPool(poolId, version);

        expect(parseInt(before.lpAmount) - parseInt(after.lpAmount)).to.be.equal(500);
      });

      it("Check withdraw & harvest", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);
        await sushi.connect(alice).withdrawAndHarvest(500, poolId, version);
      });

      it("Check owner", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);
        await expect(sushi.connect(bob).withdrawAndHarvest(500, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });

    describe("Remove Liquidity", () => {
      it("Check withdraw first", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);
        await expect(
          sushi.connect(alice).removeLiquidity(dai.address, weth.address, poolId, version),
        ).to.be.revertedWith("evan407: you have to withdraw from masterchef first");
      });

      it("Check removeLiquidity", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);

        await sushi.connect(alice).withdraw(parseInt(lpAmount), poolId, version);
        await sushi.connect(alice).removeLiquidity(dai.address, weth.address, poolId, version);
      });

      it("Check owner", async () => {
        await sushi.connect(alice).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);

        await sushi.connect(alice).withdraw(parseInt(lpAmount), poolId, version);
        await expect(sushi.connect(bob).removeLiquidity(dai.address, weth.address, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });
  });

  describe("MasterChef V2", () => {
    const poolId = 1;
    const version = 2;

    describe("Add liquidity", () => {
      it("Check the owner", async () => {
        await expect(
          sushi.connect(bob).addLiquidity(dai.address, weth.address, 50000, 100, poolId, version),
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Check the token address", async () => {
        await expect(
          sushi.connect(alice).addLiquidity(dai.address, ethers.constants.AddressZero, 50000, 100, poolId, version),
        ).to.be.revertedWith("evan407: token address must be given");
        await expect(
          sushi.connect(alice).addLiquidity(ethers.constants.AddressZero, weth.address, 100000, 15000, poolId, version),
        ).to.be.revertedWith("evan407: token address must be given");
      });

      it("Check deposit token amount", async () => {
        await expect(
          sushi.connect(alice).addLiquidity(cvx.address, weth.address, 0, 100, poolId, version),
        ).to.be.revertedWith("evan407: token amount must be bigger than 0");

        await expect(
          sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 0, poolId, version),
        ).to.be.revertedWith("evan407: token amount must be bigger than 0");
      });

      it("Check lp token amount", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);
        await expect(parseInt(lpAmount)).to.greaterThan(0);
      });
    });

    describe("Claim", () => {
      it("Check claiming", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);
        const beforeBalance = await sushi.balanceOfSushi(alice.address);
        await sushi.connect(alice).harvest(poolId, version);
        const afterBalance = await sushi.balanceOfSushi(alice.address);

        expect(afterBalance - beforeBalance).to.greaterThan(0);
      });

      it("Check the owner", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);

        await expect(sushi.connect(bob).harvest(poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });

    describe("Withdraw", () => {
      it("Check withdraw amount", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);

        await expect(sushi.connect(alice).withdraw(5000, poolId, version)).to.be.revertedWith(
          "evan407: withdraw amount must be smaller than total amount",
        );
      });

      it("Check the owner", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);

        await expect(sushi.connect(bob).withdraw(5000, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });

      it("Check withdrawing", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);
        await sushi.connect(alice).harvest(poolId, version);
        await sushi.connect(alice).withdraw(100, poolId, version);
      });

      it("Check withdraw & harvest", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);
        await sushi.connect(alice).withdrawAndHarvest(100, poolId, version);
      });

      it("Check owner", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);

        mine(100000);

        await sushi.connect(alice).harvest(poolId, version);
        await expect(sushi.connect(bob).withdrawAndHarvest(100, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });

    describe("Remove Liquidity", () => {
      it("Check withdraw first", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);
        await expect(
          sushi.connect(alice).removeLiquidity(cvx.address, weth.address, poolId, version),
        ).to.be.revertedWith("evan407: you have to withdraw from masterchef first");
      });

      it("Check removeLiquidity", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);

        await sushi.connect(alice).withdraw(parseInt(lpAmount), poolId, version);
        await sushi.connect(alice).removeLiquidity(cvx.address, weth.address, poolId, version);
      });

      it("Check owner", async () => {
        await sushi.connect(alice).addLiquidity(cvx.address, weth.address, 10000, 100, poolId, version);
        const { lpAmount } = await sushi.connect(alice).balanceOfPool(poolId, version);

        await sushi.connect(alice).withdraw(parseInt(lpAmount), poolId, version);
        await expect(sushi.connect(bob).removeLiquidity(cvx.address, weth.address, poolId, version)).to.be.revertedWith(
          "Ownable: caller is not the owner",
        );
      });
    });
  });
});
