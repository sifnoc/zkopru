import BN from 'bn.js'
import fetch from 'node-fetch'
import { toWei } from 'web3-utils'
import { TransactionReceipt } from 'web3-core'

<<<<<<< HEAD
import { F, Fp } from '@zkopru/babyjubjub'
import { DB } from '@zkopru/database'
import { Sum, UtxoStatus, Utxo, RawTx } from '@zkopru/transaction'
import { HDWallet, ZkAccount } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
=======
import { F } from '@zkopru/babyjubjub'
import { DB } from '@zkopru/database'
import { Block, serializeBody, serializeHeader } from '@zkopru/core'
import { TxBuilder, UtxoStatus, Utxo, RawTx } from '@zkopru/transaction'
import { HDWallet, ZkAccount } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
import { ProposerBase } from '@zkopru/coordinator'
import { CoordinatorContext } from '~coordinator/context'
import { ZkWallet } from '~zk-wizard'
>>>>>>> feat: create TestBlockProposer class
import {
  ZkWalletAccount,
  ZkWalletAccountConfig,
} from '~zk-wizard/zk-wallet-account'
import { TestTxBuilder } from './testbuilder'

import { logAll } from './generator-utils'

// TODO : extends to other type of assets
export type noteAmount = { eth: string; fee: string }

export interface GeneratorConfig {
  db: DB
  hdWallet: HDWallet
  account: ZkAccount
  noteAmount?: noteAmount
  weiPrice?: string
  ID?: number
}

<<<<<<< HEAD
//* * Only ETH transafer zkTx generator as 1 inflow 2 outflows */
=======
export class TestBlockProposer extends ProposerBase {
  lastProposed: string
  proposedNum: number

  constructor(context: CoordinatorContext) {
    super(context)
    this.lastProposed = '0xd1e363805bd72496bc8655758c5e3ef06482a0fa7fa64779d67663bd5f4ff73b' // genesis hash
    this.proposedNum = 0
  }

  protected async handleProcessedBlock(
    block: Block,
  ): Promise<TransactionReceipt | undefined> {
    if (!this.context.gasPrice) {
      throw Error('coordinator.js: Gas price is not synced')
    }
    const { layer1, layer2 } = this.context.node
    const blocks = await layer2.db.findMany('Header', {
      where: {
        parentBlock: block.header.parentBlock.toString(),
      },
    })
    const blockHashes = blocks.map(({ hash }) => hash)
    const siblingProposals = await layer2.db.findMany('Proposal', {
      where: {
        OR: [
          {
            hash: blockHashes,
            verified: true,
            isUncle: null,
          },
          {
            hash: block.hash.toString(),
          },
        ],
      },
    })
    if (siblingProposals.length > 0) {
      logger.info(`Already proposed for the given parent block`)
      return undefined
    }

    const bytes = Buffer.concat([
      serializeHeader(block.header),
      serializeBody(block.body),
    ])
    const blockData = `0x${bytes.toString('hex')}`
    const proposeTx = layer1.coordinator.methods.propose(blockData)
    let expectedGas: number
    try {
      expectedGas = await proposeTx.estimateGas({
        from: this.context.account.address,
      })
      logger.info(`Propose estimated gas ${expectedGas}`)
      expectedGas = Math.floor(expectedGas * 1.5)
      logger.info(`Make it 50% extra then floor gas ${expectedGas}`)
    } catch (err) {
      logger.warn(`propose() fails. Skip gen block`)
      return undefined
    }
    const expectedFee = this.context.gasPrice.muln(expectedGas)
    if (block.header.fee.toBN().lte(expectedFee)) {
      logger.info(
        `Skip gen block. Aggregated fee is not enough yet ${block.header.fee} / ${expectedFee}`,
      )
      return undefined
    }
    const receipt = await layer1.sendTx(proposeTx, this.context.account, {
      gas: expectedGas,
      gasPrice: this.context.gasPrice.toString(),
    })
    if (receipt) {
      // Additional code for Observattion over `BlockProposer` class
      if (this.lastProposed != block.hash.toString()) {
        const response = await fetch(`http://organizer:8080/propose`, {
          method: 'post',
          body: JSON.stringify({ timestamp: Date.now(), proposed: this.proposedNum, txcount: block.body.txs.length }),
        })
        if (response.status !== 200) {
          logger.warn(`Organizer well not received : ${await response.text()}`)
        }
        this.lastProposed = block.hash.toString()
        this.proposedNum += 1
      }
      logger.info(`Proposed a new block: ${block.hash.toString()}`)
    } else {
      logger.warn(`Failed to propose a new block: ${block.hash.toString()}`)
    }
    return receipt
  }
}

>>>>>>> feat: create TestBlockProposer class
export class TransferGenerator extends ZkWalletAccount {
  ID: number

  activating: boolean

  noteAmount: noteAmount

  unspentUTXO: Utxo[]

  onQueueUTXOSalt: F[]

  weiPrice: string

  worker: Worker | undefined

  lastSalt: Fp

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.ID = config.ID ?? Math.floor(Math.random() * 10000) // TODO : It seems only need in docker environment
    this.activating = false
    this.noteAmount = config.noteAmount ?? {
      eth: toWei('0.1'),
      fee: toWei('0.01'),
    }
    this.unspentUTXO = []
    this.onQueueUTXOSalt = []
    this.weiPrice = config.weiPrice ?? toWei('2000', 'gwei')

    /**  
     * Starting with Ether Note generated by deposit tx, It has 1 as salt
    
    the salt will be using a sequence for mass transaction in layer 2 as testing
     
         2 - 4 ...
       /   \  
     1       5 ...
       \     
         3 - 6 ...
           \
             7 ...
    */
    this.lastSalt = Fp.from(1)
  }


  setMaxInflow(inflowLength: number) {
    if (inflowLength > 4) {
      throw new Error(`Not allowed more than 4 inflows, circuit not support`)
    } else {
      this.maxInflowNote = inflowLength
      logger.info(`Now Set Max Inflow at ${this.maxInflowNote}`)
    }
  }

  async startGenerator() {
    if (!this.node.isRunning()) {
      this.node.start()
    }

    this.activating = true

    let tx: RawTx
    let sendableUtxo: Utxo[]
    let stagedUtxo

    logger.info(`sending deposit Tx with salt ${this.lastSalt.toString()}`)
    try {
      const result = await this.depositEther(
        this.noteAmount.eth,
        this.noteAmount.fee,
        this.account?.zkAddress,
        this.lastSalt,
      )
      if (!result) {
        throw new Error(' Deposit Transaction Failed!')
      }
    } catch (err) {
      logger.error(err)
    }

    while (this.activating) {
      this.unspentUTXO = await this.getUtxos(this.account, UtxoStatus.UNSPENT)

      // Deposit if does not exist unspent utxo in this wallet
      if (this.unspentUTXO.length === 0) {
        logger.info('No Spendable Utxo, wait until available')
        await sleep(10000)
        continue
      }

      // generate transfer Tx...
      // All transaction are self transaction with same amount, only unique things is salt.
      sendableUtxo = []

      // TODO : refactor this
      for (const utxo of this.unspentUTXO) {
        stagedUtxo = utxo
        for (let i = 0; i < this.onQueueUTXOSalt.length; i++) {
          if (this.onQueueUTXOSalt[i] == utxo.salt) {
            stagedUtxo = null
            break
          }
        }
        if (stagedUtxo) {
          sendableUtxo.push(stagedUtxo) // last utxo always in
        }
        // No need to be find all unspent utxo
        if (sendableUtxo.length >= 1) {
          break
        }
      }

      // TODO : Create Tx then goto queue
      if (sendableUtxo) {
        logger.info(
          `sendable UTXO salts are ${logAll(
            sendableUtxo.map(utxo => utxo.salt.toString()),
          )}`,
        )

        const testTxBuilder = new TestTxBuilder(this.account?.zkAddress!)
        tx = testTxBuilder
          .provide(...sendableUtxo)
          .weiPerByte(this.weiPrice)
          .sendEther({
            eth: Sum.from(sendableUtxo).eth.div(new BN(2)),
            salt: sendableUtxo[0].salt.muln(2),
            to: this.account?.zkAddress!,
          })
          .build()

        const parsedZkTx = {
          inflow: tx.inflow.map(flow => {
            return {
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
          outflow: tx.outflow.map(flow => {
            return {
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
        }
        logger.info(`Generated zkTx ${logAll(parsedZkTx)}`)
        try {
          await this.sendTx({
            tx,
            from: this.account,
            encryptTo: this.account?.zkAddress,
          })
          sendableUtxo.forEach(utxo => {
            this.onQueueUTXOSalt.push(utxo.salt)

          })
        } catch (err) {
          logger.error(err)
        }
      }
    }
  }

  stopGenerator() {
    this.activating = false
  }
}
