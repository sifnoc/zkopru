// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.7.4;
pragma experimental ABIEncoderV2;

import { SNARK } from "../target/zkopru/libraries/SNARK.sol";
import { TxValidator } from "../target/zkopru/controllers/validators/TxValidator.sol";
import { Proof, Block, Transaction, Types } from "../target/zkopru/libraries/Types.sol";
import { G1Point, G2Point } from "../target/zkopru/libraries/Pairing.sol";
import { Deserializer } from "../target/zkopru/libraries/Deserializer.sol";

contract TxValidatorTester is TxValidator {
    using SNARK for SNARK.VerifyingKey;

    string public val;

    function getProof(
        bytes calldata, //blockData
        uint256 txIndex
    ) public pure returns (Proof memory proof) {
        Block memory _block = Deserializer.blockFromCalldataAt(0);
        Transaction memory transaction = _block.body.txs[txIndex];
        return transaction.proof;
    }

    /**
     * @dev This configures a zk SNARK verification key to support the given transaction type
     * @param numOfInputs Number of inflow UTXOs
     * @param numOfOutputs Number of outflow UTXOs
     * @param vk SNARK verifying key for the given transaction type
     */
    function registerVk(
        uint8 numOfInputs,
        uint8 numOfOutputs,
        SNARK.VerifyingKey memory vk
    ) public {
        uint256 txSig = Types.getSNARKSignature(numOfInputs, numOfOutputs);
        SNARK.VerifyingKey storage key = vks[txSig];
        key.alpha1 = vk.alpha1;
        key.beta2 = vk.beta2;
        key.gamma2 = vk.gamma2;
        key.delta2 = vk.delta2;
        for (uint256 i = 0; i < vk.ic.length; i++) {
            key.ic.push(vk.ic[i]);
        }
    }

    function verifierTest() public view returns (bool) {
        // G2Point array should be inversed
        // O) vk.beta2 = G2Point(
        //     [19811020662816395949913826831567585407676075523803714650986381840854467634227, 14173549596300449247794430548163246499999877893145738428072724194035894476201],
        //     [4322486885361154879029126690175637166388453054942119754961180840902622972401, 13210901668141393159676706125825048269597063289953180933017739814760997790631]
        // );
        // X) vk.beta2 = G2Point(
        //     [14173549596300449247794430548163246499999877893145738428072724194035894476201, 19811020662816395949913826831567585407676075523803714650986381840854467634227],
        //     [13210901668141393159676706125825048269597063289953180933017739814760997790631, 4322486885361154879029126690175637166388453054942119754961180840902622972401]
        // );
        SNARK.VerifyingKey memory vk;
        vk.alpha1 = G1Point(
            8837406387318032035601534996946553946430530631619599450955115745339896383001,
            10522063869121001080984782387475783675377335183531112025320475184755487165886
        );
        vk.beta2 = G2Point(
            [
                19811020662816395949913826831567585407676075523803714650986381840854467634227,
                14173549596300449247794430548163246499999877893145738428072724194035894476201
            ],
            [
                4322486885361154879029126690175637166388453054942119754961180840902622972401,
                13210901668141393159676706125825048269597063289953180933017739814760997790631
            ]
        );
        vk.gamma2 = G2Point(
            [
                11559732032986387107991004021392285783925812861821192530917403151452391805634,
                10857046999023057135944570762232829481370756359578518086990519993285655852781
            ],
            [
                4082367875863433681332203403145435568316851327593401208105741076214120093531,
                8495653923123431417604973247489272438418190587263600148770280649306958101930
            ]
        );
        vk.delta2 = G2Point(
            [
                10413417899392065259657367517400404157190155690545308986667037246789879517903,
                12300181790658618719333938331517621264020197719333757613480318912290531973872
            ],
            [
                20663809082718225631100985297847583188511411037085882821717378620799225938924,
                8712155891799270788738257510123072026565477699069456822913320050001971590121
            ]
        );
        vk.ic = new G1Point[](2);
        vk.ic[0] = G1Point(
            15822549436196545910474483547523871814375149372816407838571264158387901149670,
            8617394207448899070458105328407693357589426565334777011994722915791478510475
        );
        vk.ic[1] = G1Point(
            1741809463132283470928491043237043640950454272858489307585783907869085952148,
            17790868394355865998307630931250581134131220333332958270981234473983869695800
        );
        uint256[] memory inputs = new uint256[](1);
        inputs[
            0
        ] = 7713112592372404476342535432037683616424591277138491596200192981572885523208;
        Proof memory proof;
        proof.a = G1Point(
            11062155262997070535099361193194531183717601593584273271838938161004303142365,
            16589927578028419930917570361738582978183416141105545066080891178090260051714
        );
        proof.b = G2Point(
            [
                5398036501440024593359936867929157100943731796357883345198409394413949500483,
                9093919378634768733036826438836927461827357013180575468319368127232568599940
            ],
            [
                4991857512086044883989068184829784919096106104771574398914555720426935992285,
                11949058279368916211429610571747589508395895205397972454493323989545254848276
            ]
        );
        proof.c = G1Point(
            6892356924219936205176489795407155614428014464351588766938673490299895990569,
            9987039144077616351908569690210398796368664729462229572732901163963907639018
        );
        bool validity = vk.verify(inputs, proof);
        return validity;
    }
}
