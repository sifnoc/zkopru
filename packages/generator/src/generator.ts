import BN from 'bn.js'
import { toWei } from 'web3-utils'
import { Queue, Worker } from 'bullmq'

import { DB } from '@zkopru/database'
import { TxBuilder, UtxoStatus, Utxo, RawTx } from '@zkopru/transaction'
import { HDWallet, ZkAccount } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
import { F } from '~babyjubjub/fp'
import { ZkWallet } from '~zk-wizard'
import {
  ZkWalletAccount,
  ZkWalletAccountConfig,
} from '~zk-wizard/zk-wallet-account'
import { logAll } from './generator-utils'

// TODO : extends to other type of assets
export type noteAmount = { eth: string; fee: string }

export interface GeneratorConfig {
  db: DB
  hdWallet: HDWallet
  account: ZkAccount
  noteAmount?: noteAmount
  maxInflowNote?: number // Can be extend to 4
  weiPrice?: string
  ID?: number
}

export class TransferGenerator extends ZkWalletAccount {
  ID: number

  private hdWallet: HDWallet

  wallet: ZkWallet

  activating: boolean

  txCount: number

  noteAmount: noteAmount

  unspentUTXO: Utxo[]

  onQueueUTXOSalt: F[]

  maxInflowNote: number // Can be extend up to 4, over 4 will be error.

  weiPrice: string

  queue: Queue

  worker: Worker | undefined

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.ID = config.ID ?? Math.floor(Math.random() * 10000) // TODO : It seems only need in docker environment
    this.activating = false
    this.txCount = 0

    this.hdWallet = config.hdWallet

    // TODO: More base generator can be added erc20 or erc721
    this.wallet = new ZkWallet({
      db: config.db,
      wallet: this.hdWallet,
      node: this.node,
      account: config.account,
      accounts: [config.account],
      erc20: [],
      erc721: [],
      snarkKeyPath: config.snarkKeyPath,
    })
    this.noteAmount = config.noteAmount ?? {
      eth: toWei('0.1'),
      fee: toWei('0.01'),
    }
    this.unspentUTXO = []
    this.onQueueUTXOSalt = []
    this.maxInflowNote = config.maxInflowNote ?? 2 // If set 1 It will increasing notes
    this.weiPrice = config.weiPrice ?? toWei('2000', 'gwei')

    // TODO : check activate redis server 
    this.queue = new Queue(`wallt_${this.ID ?? 0}`, {
      connection: { host: 'redis', port: 6379 },
    })
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
    let zkTxCount: number = 0

    while (this.activating) {
      this.unspentUTXO = await this.wallet.getUtxos(
        this.account,
        UtxoStatus.UNSPENT,
      )

      // Dequeue necessary?

      // Deposit if does not exist unspent utxo in this wallet
      if (this.unspentUTXO.length === 0) {
        logger.info('No Spendable Utxo, send Deposit Tx')
        try {
          const result = await this.wallet.depositEther(
            this.noteAmount.eth,
            this.noteAmount.fee,
            this.account?.zkAddress,
          )
          if (!result) {
            throw new Error('[Wallet] Deposit Transaction Failed!')
          }
        } catch (err) {
          logger.error(err)
        }
        await sleep(10000)
        continue
      }

      // generate transfer Tx...
      // All transaction are self transaction with same amount, only unique things is salt.
      sendableUtxo = []

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
        if (sendableUtxo.length > this.maxInflowNote) {
          logger.info(`sendable UTXO salts are ${logAll(sendableUtxo)}`)
          break
        }
      }

      // TODO : Create Tx then goto queue

      if (sendableUtxo) {
        const txBuilder = TxBuilder.from(this.account?.zkAddress!)
        tx = txBuilder
          .provide(...sendableUtxo)
          .weiPerByte(this.weiPrice)
          .sendEther({
            eth: new BN(this.noteAmount.eth).div(new BN(100)),
            to: this.account?.zkAddress!,
          })
          .build()

        const zkTx = await this.wizard.shield({
          tx,
          from: this.account!,
          encryptTo: this.account?.zkAddress,
        })
        const snarkValid = await this.node.layer2.snarkVerifier.verifyTx(zkTx)
        if (!snarkValid) {
          throw new Error('Generated snark proof is invalid')
        } else {
          // TODO : add sendable UTXO 
          // 
          this.queue.add(`zkTx-${zkTxCount}`, zkTx)
          zkTxCount++
        }
      }
    }
  }

  async startWorker() {
    if (this.worker != undefined) {
      this.worker = new Worker(`walelt_${this.ID}`, async job => {
        logger.info(`Worker job ${logAll(job)}`)
      })

      this.worker.on('completed', (job) => {
        console.log(`${job.id} has completed!`)
      })
    } else {
      logger.info(`Worker is running i guess`)
    }

  }

  async stopWorker() {
    await this.queue.pause()
    const attachedWorker = await this.queue.getWorkers()
    logger.info(`Stop queue, Current attached worker ${attachedWorker}`)
  }

  stopGenerator() {
    this.activating = false
  }
}
