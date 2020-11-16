/**
 * @jest-environment node
 */
/* eslint-disable jest/no-disabled-tests */
/* eslint-disable jest/no-commented-out-tests */
/* eslint-disable jest/no-expect-resolves */
/* eslint-disable jest/require-tothrow-message */
/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable jest/no-hooks */
import { ZkTx } from '@zkopru/transaction'
import { Context, initContext, terminate } from './cases/context'
import {
  testAliceAccount,
  testCarlAccount,
  testBobAccount,
} from './cases/1_create_accounts'
import { testRegisterVKs, testRegisterVKFails } from './cases/2_register_vks'
import {
  testCompleteSetup,
  testRejectVkRegistration,
  registerCoordinator,
  updateVerifyingKeys,
  testRegisterTokens,
} from './cases/3_complete_setup'
import {
  depositEther,
  bobDepositsErc20,
  depositERC721,
  testMassDeposits,
} from './cases/4_deposit'
import { jestExtendToCompareBigNumber, sleep } from '~utils'
import { attachConsoleErrorToPino } from '~utils/logger'
import {
  waitCoordinatorToProposeANewBlock,
  waitCoordinatorToProcessTheNewBlock,
  testBlockSync,
} from './cases/5_create_block'
import { GroveSnapshot } from '~tree/grove'
import {
  buildZkTxAliceSendEthToBob,
  buildZkTxBobSendERC20ToCarl as buildZkTxBobSendErc20ToCarl,
  buildZkTxCarlSendNftToAlice,
  testRound1SendZkTxsToCoordinator,
  testRound1NewBlockProposal,
  testRound1NewSpendableUtxos,
} from './cases/6_zk_tx_round_1'
import {
  buildZkTxAliceWithrawNFT,
  buildZkTxBobWithdrawEth,
  buildZkTxCarlWithdrawErc20,
  testRound2NewBlockProposal,
  testRound2NewSpendableUtxos,
  testRound2SendZkTxsToCoordinator,
} from './cases/7_zk_tx_round_2'

jestExtendToCompareBigNumber(expect)

describe('testnet', () => {
  let context!: Context
  const ctx = () => context
  beforeAll(async () => {
    attachConsoleErrorToPino()
    context = await initContext()
  }, 90000)
  afterAll(async () => {
    console.log('terminating...')
    await terminate(ctx)
  }, 30000)
  describe('contract deployment', () => {
    it('should define zkopru address', () => {
      // eslint-disable-next-line jest/no-if
      const message = ctx().zkopruAddress
        ? 'Test environment is ready'
        : 'Try to adjust timeout or check docker status'
      console.log(message)
      expect(context.zkopruAddress).toBeDefined()
    })
  })
  describe('1: Zk Account', () => {
    it(
      'alice should have 100 ETH for her initial balance',
      testAliceAccount(ctx),
    )
    it('bob should have 100 ETH for his initial balance', testBobAccount(ctx))
    it('carl should have 100 ETH for his initial balance', testCarlAccount(ctx))
  })
  describe('2: Register verifying keys', () => {
    it('coordinator can register vks', testRegisterVKs(ctx), 30000)
    it('alice, bob, and carl cannot register vks', testRegisterVKFails(ctx))
  })
  describe('3: Complete setup', () => {
    // Wallets were initialized with empty vks because they were not registered on chain yet.
    // Therefore update the verifying keys after complete the setup process. This process is only needed in this integration test.
    afterAll(updateVerifyingKeys(ctx))
    describe('3-1: before completeSetup() called', () => {
      it('should allow only the coordinator', testCompleteSetup(ctx))
    })
    describe('3-2: after completeSetup() called', () => {
      it('should reject every register txs', testRejectVkRegistration(ctx))
    })
    describe('3-3: coordinator can register ERC20 or ERC721 tokens.', () => {
      it('should register sample erc20 and erc721', testRegisterTokens(ctx))
    })
  })
  describe('4: Deposits', () => {
    describe('4-1: users deposit assets', () => {
      it('ether: Alice, Bob, and Carl each deposit 10 ETH', depositEther(ctx))
      it('erc20: Bob deposits ERC20', bobDepositsErc20(ctx))

      it('erc721: Carl deposits NFTs', depositERC721(ctx))
    })
    describe('4-2: coordinator commits MassDeposit', () => {
      it(
        'coordinator should have 5 pending deposits',
        testMassDeposits(ctx),
        30000,
      )
    })
  })
  describe('5: Coordinator create the first block', () => {
    let prevGroveSnapshot!: GroveSnapshot
    let newGroveSnapshot!: GroveSnapshot
    beforeAll(async () => {
      const { coordinator } = ctx()
      prevGroveSnapshot = await coordinator.layer2().grove.getSnapshot()
    })
    describe('register coordinator account', () => {
      // later it should be replaced with the burn auction
      it('should register "coordinator" account', registerCoordinator(ctx))
    })
    describe('coordinator creates the first block when the aggregated fee is enough', () => {
      afterAll(async () => {
        const { coordinator } = ctx()
        newGroveSnapshot = await coordinator.layer2().grove.getSnapshot()
      })
      it(
        'should propose a new block within a few seconds',
        waitCoordinatorToProposeANewBlock(ctx),
        30000,
      )
      it(
        'should process the new submitted block',
        waitCoordinatorToProcessTheNewBlock(ctx),
        30000,
      )
    })
    describe('new block should update trees', () => {
      it('should increase utxo index to at least 32(sub tree size)', () => {
        expect(
          prevGroveSnapshot.utxoTreeIndex.addn(32).toString(),
        ).toStrictEqual(newGroveSnapshot.utxoTreeIndex.toString())
      })
      it('should update the utxo root', () => {
        expect(prevGroveSnapshot.utxoTreeRoot.toString()).not.toStrictEqual(
          newGroveSnapshot.utxoTreeRoot.toString(),
        )
      })
    })
    describe('users subscribe Proposal() events', () => {
      it(
        'wallets should have updated processed block number',
        testBlockSync(ctx),
        15000,
      )
    })
  })
  describe('6: Zk Transactions round 1', () => {
    let aliceTransfer: ZkTx
    let bobTransfer: ZkTx
    let carlTransfer: ZkTx
    let prevLatestBlock: string
    const subCtx = () => ({
      aliceTransfer,
      bobTransfer,
      carlTransfer,
      prevLatestBlock,
    })
    describe('users send zk txs to the coordinator', () => {
      beforeAll(async () => {
        do {
          const latest = await context.coordinator.node().latestBlock()
          if (latest !== null) {
            prevLatestBlock = latest
            break
          }
          await sleep(1000)
        } while (!prevLatestBlock)
      }, 30000)
      it('create 3 transactions: alice transfer 1 Ether to Bob. Bob transfer 1 ERC20 to Carl, and Carl transfer 1 nft to Alice', async () => {
        aliceTransfer = await buildZkTxAliceSendEthToBob(ctx)
        bobTransfer = await buildZkTxBobSendErc20ToCarl(ctx)
        carlTransfer = await buildZkTxCarlSendNftToAlice(ctx)
      }, 300000)
      it(
        'they should send zk transactions to the coordinator',
        testRound1SendZkTxsToCoordinator(ctx, subCtx),
        60000,
      )
      it(
        'coordinator should propose a new block and wallet clients subscribe them',
        testRound1NewBlockProposal(ctx, subCtx),
        600000,
      )
      it(
        'wallets should have new spendable utxos as they sync the new block',
        testRound1NewSpendableUtxos(ctx),
        40000,
      )
    })
  })
  describe('7: Zk Transactions round 2', () => {
    let aliceWithdrawal: ZkTx
    let bobWithdrawal: ZkTx
    let carlWithdrawal: ZkTx
    let prevLatestBlock: string
    const subCtx = () => ({
      aliceWithdrawal,
      bobWithdrawal,
      carlWithdrawal,
      prevLatestBlock,
    })
    describe('users withdraw their assets from the layer 2', () => {
      beforeAll(async () => {
        do {
          const latest = await context.coordinator.node().latestBlock()
          if (latest !== null) {
            prevLatestBlock = latest
            break
          }
          await sleep(1000)
        } while (!prevLatestBlock)
      }, 30000)
      it('create 3 transactions: alice withdraw 1 NFT. Bob withdraw 1 ETH, and Carl withdraw 1 ERC20', async () => {
        aliceWithdrawal = await buildZkTxAliceWithrawNFT(ctx)
        bobWithdrawal = await buildZkTxBobWithdrawEth(ctx)
        carlWithdrawal = await buildZkTxCarlWithdrawErc20(ctx)
      }, 300000)
      it(
        'they should send zk transactions to the coordinator',
        testRound2SendZkTxsToCoordinator(ctx, subCtx),
        60000,
      )
      it(
        'coordinator should propose a new block and wallet clients subscribe them',
        testRound2NewBlockProposal(ctx, subCtx),
        600000,
      )
      it(
        'wallets should have new spendable utxos as they sync the new block',
        testRound2NewSpendableUtxos(ctx),
        40000,
      )
    })
    describe('coordinator creates the 3rd block including zk txs', () => {
      it.todo('should contain 3 valid txs')
      it.todo('should not include the invalid tx')
      it.todo('should update the utxo tree')
      it.todo('should update the nullifier tree')
    })
    describe('users subscribe Proposal() event and try to decrypt memos', () => {
      it.todo('bob should receive ERC721')
      it.todo('alice should receive ERC20')
    })
  })
  describe('7: Withdrawal', () => {
    describe('users send zk txs to the coordinator', () => {
      it.todo('alice sends an ERC20 withdrawal tx to the coordinator')
      it.todo('bob sends an ERC721 withdrawal tx to the coordinator')
      it.todo('carl sends Ether withdrawal tx to the coordinator')
    })
    describe('coordinator creates the 4rd block including zk txs', () => {
      it.todo('should contain 3 valid txs')
      it.todo('should update the withdrawal tree root')
      it.todo('should update the utxo tree')
      it.todo('should update the nullifier tree')
      it.todo('should update the withdrawal tree')
    })
  })
  describe('8: Instant withdrawal', () => {
    describe('alice sends an instant withdrawal tx', () => {
      it.todo('should pay extra fee to the coordinator')
    })
    describe('coordinator provides upfront payment', () => {
      it.todo("should be paid from the coordinator's own account")
    })
    describe('alice gets ERC20s on the main network', () => {
      it.todo('should top up an empty account of Alice')
    })
  })
  describe('9: Finalization', () => {
    describe('coordinator calls finalize()', () => {
      it.todo('should update the latest block')
      it.todo('should give reward to the coordinator')
    })
    describe('users subscribe Finalization() and run withdraw()', () => {
      it.todo('bob gets ERC 721 on the main network')
      it.todo('carl gets ERC 721 on the main network')
      it.todo('alice fails the double-withdrawal')
      it.todo(
        'should pay back the upfront payment for alice to the coordinator',
      )
    })
  })
  describe('10: Challenge', () => {
    describe('fraud', () => {
      it.todo('coordinator creates an invalind utxo roll up')
    })
    describe('watchdog', () => {
      it.todo('alice catches the fraud and submit a challenge')
    })
    describe('slash', () => {
      it.todo('coordinator gets slashed and the block gets invalidated')
      it.todo('alice gets the challenge reward')
    })
    describe('revert', () => {
      it.todo('every clients should update the revert')
    })
  })
  describe('11: Migration', () => {
    it.todo('please add test scenarios here')
  })
})
