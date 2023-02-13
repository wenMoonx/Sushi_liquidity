// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

import "./interfaces/ISushiRouter.sol";
import "./interfaces/ISushiFactory.sol";
import "./interfaces/IMasterChefV1.sol";
import "./interfaces/IMasterChefV2.sol";
import "./interfaces/IMasterChefRewarder.sol";

/// @title A liquidity program using sushiSwap
/// @author Evan Jones
/// @notice You can use this contract for only the most basic simulation
/// @dev All function calls are currently implemented without side effects
contract Sushi is Ownable {
    using SafeERC20 for IERC20;

    /// @dev these represents deployed addresses on etherum mainnet
    address private constant Router = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F; // SUSHI Router address
    address private constant Factory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac; // SUSHI Factory address
    address private constant SUSHI = 0x6B3595068778DD592e39A122f4f5a5cF09C90fE2; // SUSHI Token address

    IMasterChefV2 immutable masterChefV2 = IMasterChefV2(0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d);
    IMasterChefV1 immutable masterChefV1 = IMasterChefV1(0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd);

    /// @notice Users can call this function to deposit their token on sushiSwap
    /// @param _tokenA address
    /// @param _tokenB address
    /// @param _amountA uint
    /// @param _amountB uint
    function addLiquidity(
        address _tokenA,
        address _tokenB,
        uint _amountA,
        uint _amountB,
        uint _poolId,
        uint _version
    ) external onlyOwner {
        require(_tokenA != address(0) && _tokenB != address(0), "evan407: token address must be given");
        require(_amountA > 0 && _amountB > 0, "evan407: token amount must be bigger than 0");

        _addLiquidity(_tokenA, _tokenB, _amountA, _amountB, _poolId, _version);
    }

    /// @dev This function must be called under the condition that validation has been performed
    /// @notice This function is called by addLiquidity Function
    function _addLiquidity(
        address _tokenA,
        address _tokenB,
        uint _amountA,
        uint _amountB,
        uint _poolId,
        uint _version
    ) internal {
        IERC20(_tokenA).safeTransferFrom(msg.sender, address(this), _amountA);
        IERC20(_tokenB).safeTransferFrom(msg.sender, address(this), _amountB);

        _approve(_tokenA, Router, _amountA);
        _approve(_tokenB, Router, _amountB);

        address pair = ISushiFactory(Factory).getPair(_tokenA, _tokenB);

        (, , uint liquidity) = ISushiRouter(Router).addLiquidity(
            _tokenA,
            _tokenB,
            _amountA,
            _amountB,
            1,
            1,
            address(this),
            block.timestamp + 60
        );

        // Deposit SLP token to MasterChef for earning SUSHI token as a reward
        _deposit(pair, liquidity, _poolId, _version);
    }

    /// @notice Users can remove their tokens from pool
    /// @dev Before removing, have to withdraw their SPL token and claim their reward(SUSHI)
    /// @dev After doing removeLiquidity, have to send the user's tokens from this contract to user
    /// @param _tokenA To remove tokenA
    /// @param _tokenB To remove tokenB
    /// @param _poolId Masterchef Pool id
    /// @param _version Masterchef version
    function removeLiquidity(address _tokenA, address _tokenB, uint _poolId, uint _version) external onlyOwner {
        (uint lpAmount, ) = balanceOfPool(_poolId, _version);
        require(lpAmount == 0, "evan407: you have to withdraw from masterchef first");

        address pair = ISushiFactory(Factory).getPair(_tokenA, _tokenB);
        uint amount = IERC20(pair).balanceOf(address(this));
        IERC20(pair).approve(Router, amount);

        (uint _amountA, uint _amountB) = ISushiRouter(Router).removeLiquidity(
            _tokenA,
            _tokenB,
            amount,
            1,
            1,
            address(this),
            block.timestamp + 60
        );

        // after removing liquidity, the contract have to transfer the user's tokens to user
        IERC20(_tokenA).safeTransfer(msg.sender, _amountA);
        IERC20(_tokenB).safeTransfer(msg.sender, _amountB);
    }

    /// @notice Deposit lp token to MasterChef for earning SUSHI token
    /// @param _token deposit token address to MasterChef
    /// @param _want deposit token amount to MasterChef
    /// @param _poolId MasterChef pool id to deposit
    /// @param _version MasterChef version
    function _deposit(address _token, uint _want, uint _poolId, uint _version) public onlyOwner {
        if (_version == 2) {
            _approve(_token, address(masterChefV2), _want);
            masterChefV2.deposit(_poolId, _want, address(this));
        } else {
            _approve(_token, address(masterChefV1), _want);
            masterChefV1.deposit(_poolId, _want);
        }
    }

    /// @notice Get the reward
    /// @param _poolId MasterChef Pool Id
    /// @param _version MasterChef version
    function harvest(uint _poolId, uint _version) public onlyOwner {
        if (_version == 1) {
            masterChefV1.deposit(_poolId, 0);
            uint256 _sushi = balanceOfSushi(address(this));

            IERC20(SUSHI).safeTransfer(msg.sender, _sushi);
        } else masterChefV2.harvest(_poolId, msg.sender);
    }

    function withdrawAndHarvest(uint _lpTokenAmount, uint _poolId, uint _version) public onlyOwner {
        if (_version == 2) masterChefV2.withdrawAndHarvest(_poolId, _lpTokenAmount, msg.sender);
        else withdraw(_lpTokenAmount, _poolId, _version);
    }

    /// @notice To withdraw their SLP token from MasterChef, also claim their reward from Masterchef
    /// @param _lpTokenAmount The token amount to withdraw
    /// @param _poolId MasterChef pool Id
    /// @param _version MasterChef version to use
    function withdraw(uint256 _lpTokenAmount, uint _poolId, uint _version) public onlyOwner returns (uint256) {
        (uint lpAmount, ) = balanceOfPool(_poolId, _version);
        require(lpAmount >= _lpTokenAmount, "evan407: withdraw amount must be smaller than total amount");

        // We have to claim reward here because user's staking amount is going to be changed.
        if (_version == 1) masterChefV1.withdraw(_poolId, _lpTokenAmount);
        else masterChefV2.withdraw(_poolId, _lpTokenAmount, address(this));

        return _lpTokenAmount;
    }

    /// @notice Approve token to transfer their token
    /// @dev First set approve amount zero to prevent overflow approve amount
    function _approve(address _token, address _spender, uint _amount) internal {
        IERC20(_token).safeApprove(_spender, 0);
        IERC20(_token).safeApprove(_spender, _amount);
    }

    /// @notice Users can get their balance on masterChef pool
    function balanceOfPool(uint _poolId, uint _verions) public view returns (uint256 lpAmount, uint256 rewardsAmount) {
        if (_verions == 2) (lpAmount, rewardsAmount) = masterChefV2.userInfo(_poolId, address(this));
        else (lpAmount, rewardsAmount) = masterChefV1.userInfo(_poolId, address(this));
    }

    // /// @notice Check total SUSHI amount at the some time
    // function getHarvestable(uint _poolId) external view returns (uint pendingSushi, uint pendingReward) {
    //     pendingSushi = masterChefV2.pendingSushi(_poolId, address(this));
    //     IMasterChefRewarder rewarder = IMasterChefRewarder(masterChefV2.rewarder(_poolId));
    //     (, uint[] memory _rewardAmounts) = rewarder.pendingTokens(_poolId, address(this), 0);

    //     if (_rewardAmounts.length > 0) {
    //         pendingReward = _rewardAmounts[0];
    //     }
    // }

    function balanceOfSushi(address _user) public view returns (uint) {
        return IERC20(SUSHI).balanceOf(_user);
    }
}
