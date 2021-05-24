import BN from 'bn.js'
import { toWei } from 'web3-utils'
import { Queue, Worker } from 'bullmq'

import { F, Fp } from '@zkopru/babyjubjub'
import { DB } from '@zkopru/database'
import { UtxoStatus, Utxo, RawTx, ZkAddress } from '@zkopru/transaction'
import { HDWallet, ZkAccount } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
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
  maxInflowNote?: number // Can be extend up to 4
  weiPrice?: string
  ID?: number
}


export class TransferGenerator extends ZkWalletAccount {
  ID: number

  // private hdWallet: HDWallet

  // wallet: ZkWalletAccount

  activating: boolean

  txCount: number

  noteAmount: noteAmount

  unspentUTXO: Utxo[]

  onQueueUTXOSalt: F[]

  private _inflowNoteCount: number // Can be extend up to 4, over 4 will be error.

  weiPrice: string

  queue: Queue

  worker: Worker | undefined

  lastSalt: Fp

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.ID = config.ID ?? Math.floor(Math.random() * 10000) // TODO : It seems only need in docker environment
    this.activating = false
    this.txCount = 0

    // this.hdWallet = config.hdWallet
    this.noteAmount = config.noteAmount ?? {
      eth: toWei('0.1'),
      fee: toWei('0.01'),
    }
    this.unspentUTXO = []
    this.onQueueUTXOSalt = []
    this._inflowNoteCount = config.maxInflowNote ?? 1 // If set 1 It will increasing notes
    this.weiPrice = config.weiPrice ?? toWei('2000', 'gwei')

    // TODO : check activate redis server 
    this.queue = new Queue(`wallt_${this.ID ?? 0}`, {
      connection: { host: 'redis', port: 6379 },
    })

    this.lastSalt = Fp.from(1)
  }

  get inflowCount() {
    return this._inflowNoteCount
  }

  setInflowCount(inflowLength: number) {
    if (Math.floor(inflowLength) != inflowLength) {
      throw new Error(`Only integer is allow to set inflow Note count`)
    }
    if (inflowLength > 4 || inflowLength < 1) {
      throw new Error(`Can use from 1 to 4 note for inflow, circuit not support`)
    } else {
      this._inflowNoteCount = inflowLength
      logger.info(`Now Set Max Inflow at ${this._inflowNoteCount}`)
    }
  }

  async sendTxsave({
    tx,
    from,
    encryptTo,
  }: {
    tx: RawTx
    from?: ZkAccount
    encryptTo?: ZkAddress
  }): Promise<void> {
    const zkTx = await this.shieldTx({ tx, from, encryptTo })
    const response = await this.sendLayer2Tx(zkTx)
    if (response.status !== 200) {
      await this.unlockUtxos(tx.inflow)
      throw Error(await response.text())
    } else {
      this.queue.add(`zkTx-${this.ID}`, zkTx) // TODO : save to file later, for now testing
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
      this.unspentUTXO = await this.getUtxos(
        this.account,
        UtxoStatus.UNSPENT,
      )
      // TODO : pregenerate idea 

      // Deposit if does not exist unspent utxo in this wallet
      if (this.unspentUTXO.length === 0) {
        logger.info('No Spendable Utxo, send Deposit Tx')
        logger.info(`sending deposit Tx with salt ${this.lastSalt.toString()}`)
        try {
          const result = await this.depositEther(
            this.noteAmount.eth,
            this.noteAmount.fee,
            this.lastSalt,
            this.account?.zkAddress,
          )
          if (!result) {
            throw new Error('[Wallet] Deposit Transaction Failed!')
          } else {
            this.lastSalt = this.lastSalt.add(new Fp(1000000))
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
        if (sendableUtxo.length >= this._inflowNoteCount) {
          break
        }
      }

      // TODO : Create Tx then goto queue - WIP
      // TODO : Make it Always 1 Inflow 2 Outflow
      if (sendableUtxo) {
        logger.info(`sendable UTXO salts are ${logAll(sendableUtxo.map(utxo => utxo.salt.toString()))}`)
        const testTxBuilder = new TestTxBuilder(this.account?.zkAddress!)
        tx = testTxBuilder
          .provide(...sendableUtxo)
          .weiPerByte(this.weiPrice)
          .sendEther({
            eth: new BN(this.noteAmount.eth).div(new BN(2)),
            salt: sendableUtxo[0].salt.muln(2),
            to: this.account?.zkAddress!,
          })
          .build()

        logger.info(`Generated zkTx ${logAll(tx)}`)
        try {
          // await this.wallet.sendTx({
          await this.sendTxsave({
            tx,
            from: this.account,
            encryptTo: this.account?.zkAddress,
          })
          sendableUtxo.forEach(utxo => {
            this.onQueueUTXOSalt.push(utxo.salt)
          })
          zkTxCount += 1
          logger.info(`zk Tx successfully sent ${zkTxCount}`)
        } catch (err) {
          logger.error(err)
        }
      }

      // const zkTx = await this.wizard.shield({
      //   tx,
      //   from: this.account!,
      //   encryptTo: this.account?.zkAddress,
      // })

      // // TODO : add sendable UTXO 
      // // 
      // this.queue.add(`zkTx-${zkTxCount}`, zkTx)
      // zkTxCount++
    }
  }

  // TODO: check necessary
  async checkQueue() {
    // result: 100 zkTx in about 200 sec
    let startTime
    let endTime
    this.queue.on('waiting', async () => {
      const jobsInQueue = await this.queue.getJobCounts('wait', 'active', 'complete')
      if (jobsInQueue['wait'] == 1) {
        startTime = new Date()
      }
      if ((jobsInQueue['wait'] % 100) == 100) {
        endTime = new Date()
        logger.info(`Jobs In Queue : ${logAll(jobsInQueue)}`)
        logger.info(`100 zkTx generated in ${endTime - startTime}`)
      }
    })
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
