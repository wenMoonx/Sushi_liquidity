// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

import "./interfaces/ISushiRouter.sol";
import "./interfaces/ISushiChef.sol";
import "./interfaces/ISushiFactory.sol";

/// @title A liquidity program using sushiSwap
/// @author Evan Jones
/// @notice You can use this contract for only the most basic simulation
/// @dev All function calls are currently implemented without side effects
contract Sushi {
    using SafeERC20 for IERC20;

    struct Staker {
        uint256 amount;
        uint256 lastRewardSum;
    }

    uint256 private totalStakingAmount;
    uint256 private rewardSumPerShare;

    mapping(address => Staker) private stakers;
    /// @dev these represents deployed addresses on etherum mainnet
    address private constant Router = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F; // SUSHI Router address
    address private constant Factory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac; // SUSHI Factory address
    address private constant MasterChef = 0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd; // MasterChef V1 address
    address private constant SUSHI = 0x6B3595068778DD592e39A122f4f5a5cF09C90fE2; // SUSHI Token address
    uint private constant PoolId = 2; // The pid of DAI/WETH LP token is alreadly created as 2

    uint256 constant REWARD_PRECISION = 1e10; // To ensure accuracy

    /// @notice Users can call this function to deposit their token on sushiSwap
    /// @param _tokenA address
    /// @param _tokenB address
    /// @param _amountA uint
    /// @param _amountB uint
    function addLiquidity(address _tokenA, address _tokenB, uint _amountA, uint _amountB) external {
        require(_tokenA != address(0) && _tokenB != address(0), "evan407 token address must be given");
        require(_amountA > 0 && _amountB > 0, "evan407 token amount must be bigger than 0");

        _addLiquidity(_tokenA, _tokenB, _amountA, _amountB);
    }

    /// @dev This function must be called under the condition that validation has been performed
    /// @notice This function is called by addLiquidity Function
    function _addLiquidity(address _tokenA, address _tokenB, uint _amountA, uint _amountB) internal {
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

        Staker storage staker = stakers[msg.sender];

        // We have to claim reward here because user's staking amount is going to be changed.
        claim();

        staker.amount += liquidity;
        totalStakingAmount += liquidity;
        staker.lastRewardSum = rewardSumPerShare;

        // Deposit SLP token to MasterChef for earning SUSHI token as a reward
        _deposit(pair, liquidity);
    }

    /// @notice Users can remove their tokens from pool
    /// @dev Before removing, have to withdraw their SPL token and claim their reward(SUSHI)
    /// @dev After doing removeLiquidity, have to send the user's tokens from this contract to user
    /// @param _tokenA To remove tokenA
    /// @param _tokenB To remove tokenB
    function removeLiquidity(address _tokenA, address _tokenB) external {
        address pair = ISushiFactory(Factory).getPair(_tokenA, _tokenB);

        Staker storage staker = stakers[msg.sender];
        uint amount = staker.amount;
        withdraw(staker.amount);

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
    function _deposit(address _token, uint _want) public {
        _approve(_token, MasterChef, _want);
        ISushiChef(MasterChef).deposit(PoolId, _want);
    }

    /// @notice To withdraw their SLP token from MasterChef, also claim their reward from Masterchef
    /// @param _lpTokenAmount The token amount to withdraw
    function withdraw(uint256 _lpTokenAmount) public returns (uint256) {
        Staker storage staker = stakers[msg.sender];
        require(staker.amount >= _lpTokenAmount, "evan407 withdraw amount must be smaller than total amount");

        // We have to claim reward here because user's staking amount is going to be changed.
        claim();
        staker.amount -= _lpTokenAmount;
        totalStakingAmount -= _lpTokenAmount;
        staker.lastRewardSum = rewardSumPerShare;

        ISushiChef(MasterChef).withdraw(PoolId, _lpTokenAmount);
        return _lpTokenAmount;
    }

    /// @notice Approve token to transfer their token
    /// @dev First set approve amount zero to prevent overflow approve amount
    function _approve(address _token, address _spender, uint _amount) internal {
        IERC20(_token).safeApprove(_spender, 0);
        IERC20(_token).safeApprove(_spender, _amount);
    }

    /// @notice Users can get their balance on masterChef pool
    function balanceOfPool() public view returns (uint256) {
        (uint256 amount, ) = ISushiChef(MasterChef).userInfo(PoolId, address(this));
        return amount;
    }

    function balanceOfSushi(address _user) public view returns (uint) {
        return IERC20(SUSHI).balanceOf(_user);
    }

    /// @notice Check total SUSHI amount at the some time
    function getHarvestable() public view returns (uint256) {
        return ISushiChef(MasterChef).pendingSushi(PoolId, address(this));
    }

    /// @notice claim the reward of all reward tokens
    /// @dev To earn SUSHI, need to set deposit amount 0
    function claim() public {
        updateRewards(); // update the rewardSumPerShare amount

        Staker storage staker = stakers[msg.sender];

        uint256 rewardtoClaim = ((rewardSumPerShare - staker.lastRewardSum) * staker.amount) / REWARD_PRECISION;

        ISushiChef(MasterChef).deposit(PoolId, 0);
        uint256 _sushi = balanceOfSushi(address(this));

        if (_sushi > rewardtoClaim) {
            IERC20(SUSHI).safeTransfer(msg.sender, rewardtoClaim);
        }

        staker.lastRewardSum = rewardSumPerShare;
    }

    /**
     * @dev internal function to update rewardSumPerShare
     */
    function updateRewards() internal {
        uint _reward = getHarvestable();
        if (totalStakingAmount == 0) {
            return;
        }

        rewardSumPerShare += (_reward * REWARD_PRECISION) / totalStakingAmount;
    }
}
