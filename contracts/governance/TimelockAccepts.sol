// SPDX-License-Identifier: GPL-3                                                    
pragma solidity 0.8.28;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract TimelockAccepts is TimelockController {

    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0)) { }

    function acceptAdmin() public pure returns (bool) { return true; }
}
