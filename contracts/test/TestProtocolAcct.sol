// SPDX-License-Identifier: Unlicensed
pragma solidity >=0.8.4;
pragma experimental ABIEncoderV2;

import "../libraries/CurveMath.sol";
import "../mixins/ProtocolAccount.sol";

contract TestProtocolAccount is ProtocolAccount {
    using TokenFlow for TokenFlow.PairSeq;
        
    constructor (address auth) {
        authority_ = auth;
    }
    
    function testAccum (address base, address quote,
                        uint128 baseFees, uint128 quoteFees) public {
        TokenFlow.PairSeq memory pair;
        pair.nextHop(base, quote);
        pair.flow_.baseProto_ = baseFees;
        pair.flow_.quoteProto_ = quoteFees;
        accumProtocolFees(pair);
    }

    function noop() payable public { }

    function etherBalance (address x) public view returns (uint256) {
        return x.balance;
    }

    function protoFeeAccum (address token) public view returns (uint128) {
        return feesAccum_[token];
    }

    function disburseProtocol (address recv, address token)
        public protocolOnly {
        disburseProtocolFees(recv, token);
    }
}
