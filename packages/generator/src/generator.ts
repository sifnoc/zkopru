// import fs from 'fs'
import BN from 'bn.js'
import { toWei } from 'web3-utils'
import { Queue, Worker, ConnectionOptions, Job, QueueScheduler } from 'bullmq'
import fetch from 'node-fetch'

import { Fp } from '@zkopru/babyjubjub'
import { UtxoStatus, Utxo } from '@zkopru/transaction'
import { HDWallet } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
import { ZkWalletAccount, ZkWalletAccountConfig } from '@zkopru/zk-wizard'
import { TestTxBuilder } from './testbuilder'
import { jsonToZkTx, logAll } from './generator-utils'

export interface GeneratorConfig {
  hdWallet: HDWallet
  weiPrice?: string
  ID?: number
  redis?: { host: string; port: number }
  preZkTxPath?: string
}

interface Queues {
  mainQueue: Queue
  walletQueue: Queue
}

const organizerUrl = process.env.ORGANIZER_URL ?? 'http://organizer:8080'

//* * Only ETH transafer zkTx generator as 1 inflow 2 outflows */
export class TransferGenerator extends ZkWalletAccount {
  ID: number

  isActive: boolean

  lastSalt: number

  usedUtxoSalt: Set<number>

  weiPrice: string

  preZkTxPath: string

  queues: Queues

  queueConnection: ConnectionOptions

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.ID = config.ID ?? Math.floor(Math.random() * 10000) // TODO : It seems only need in docker environment
    this.isActive = false
    this.preZkTxPath =
      config.preZkTxPath ?? `/proj/packages/generator/zktx/${this.ID}`
    this.lastSalt = 0
    this.usedUtxoSalt = new Set([])
    this.weiPrice = config.weiPrice ?? toWei('2000', 'gwei')

    /**  
     * Starting with Ether Note generated by deposit tx, It has 1 as salt
    
    the salt will be using a sequence for mass transaction in layer 2 for testing
     
         2 - 4 ...
       /   \  
     1       5 ...
       \     
         3 - 6 ...
           \
             7 ...
    */
    this.queueConnection = {
      host: config.redis?.host ?? 'localhost',
      port: config.redis?.port ?? 6379,
    }

    this.queues = {
      mainQueue: new Queue('mainTxQueue', { connection: this.queueConnection }),
      walletQueue: new Queue(`wallet${this.ID}`, {
        connection: this.queueConnection,
      }),
    }
  }

  async startWorker() {
    logger.info(`Worker started`)
    const worker = new Worker(
      `wallet${this.ID}`,
      async (job: Job) => {
        const { rawTx, rawZkTx } = job.data
        const { tx, zkTx } = jsonToZkTx(rawTx, rawZkTx)

        const txSalt = tx.inflow[0].salt
        const response = await this.sendLayer2Tx(zkTx)
        if (response.status !== 200) {
          throw Error(await response.text())
        } else {
          this.lastSalt = txSalt.toNumber()
          await this.unlockUtxos(tx.inflow)
        }
      },
      { connection: this.queueConnection },
    )

    worker.on('completed', (job: Job) => {
      logger.info(
        `Worker job salt ${logAll(job.data.rawTx.inflow[0].salt)} completed`,
      )
    })

    const walletScheduler = new QueueScheduler(`wallet${this.ID}`, {
      connection: this.queueConnection,
    })
    logger.info(`${walletScheduler.name} scheduler on`)
  }

  async startGenerator() {
    if (!this.node.isRunning()) {
      this.node.start()
    }

    // TODO: check first deposit Note hash
    try {
      const result = await this.depositEther(
        toWei('50'),
        toWei('0.01'),
        this.account?.zkAddress,
        Fp.from(1),
      )
      if (!result) {
        throw new Error(' Deposit Transaction Failed!')
      } else {
        logger.info(`Deposit Tx sent`)
      }
    } catch (err) {
      logger.error(err)
    }

    while (!this.isActive) {
      await sleep(1000)
      const stagedDeposit = await this.node.layer1.upstream.methods
        .stagedDeposits()
        .call()

      if (+stagedDeposit.merged === 0) {
        this.isActive = true
        // TODO: replace organizer url from system environment
        fetch(`${organizerUrl}/register`, {
          method: 'post',
          body: JSON.stringify({
            ID: this.ID,
            address: this.account?.ethAddress,
          }),
        })
        logger.info(
          `Deposit Tx is processed, then registered this wallet to Organizer`,
        )
      }
    }

    this.startWorker()

    while (this.isActive) {
      const onQueue = await this.queues.mainQueue.getJobCounts(
        'wait',
        'active',
        'delayed',
      )
      /* eslint-disable no-continue */
      if (onQueue.wait + onQueue.active + onQueue.delayed >= 10) {
        await sleep(1000)
        continue
      }

      logger.info(`get unspent UTxo`)
      const unspentUTXO = await this.getUtxos(this.account, UtxoStatus.UNSPENT)

      if (unspentUTXO.length === 0) {
        logger.info('No Spendable Utxo, wait until available')
        await sleep(5000)
        continue
      }

      logger.info(`check sendable utxo is`)

      // All transaction are self transaction with same amount, only unique things is salt.
      let sendableUtxo: Utxo | undefined

      for (const utxo of unspentUTXO) {
        let isUsedUtxo = false
        if (this.usedUtxoSalt.has(utxo.salt.toNumber())) {
          isUsedUtxo = true
        }

        if (!isUsedUtxo) {
          sendableUtxo = utxo
          break
        }
      }

      if (sendableUtxo) {
        const testTxBuilder = new TestTxBuilder(this.account?.zkAddress!)
        const tx = testTxBuilder
          .provide(sendableUtxo)
          .weiPerByte(this.weiPrice)
          .sendEther({
            eth: sendableUtxo.asset.eth.div(new BN(2)), // TODO: eth amount include a half of fee
            salt: sendableUtxo.salt.muln(2),
            to: this.account?.zkAddress!,
          })
          .build()

        const parsedZkTx = {
          inflow: tx.inflow.map(flow => {
            return {
              hash: flow.hash().toString(),
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
          outflow: tx.outflow.map(flow => {
            return {
              hash: flow.hash().toString(),
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
        }
        logger.info(`Created ZkTx : ${logAll(parsedZkTx)}`)
        try {
          const zkTx = await this.shieldTx({ tx })
          // fs.writeFileSync(`/proj/packages/generator/zktx/${this.ID}/${tx.inflow[0].salt.toString(10)}.json`, JSON.stringify({ rawTx: tx, rawZkTx: zkTx }))
          this.usedUtxoSalt.add(sendableUtxo.salt.toNumber())
          this.queues.mainQueue.add(`wallet${this.ID}`, {
            rawTx: tx,
            rawZkTx: zkTx,
          })
        } catch (err) {
          logger.error(err)
        }
      } else {
        logger.debug(`No available utxo for now wait 5 sec`)
        await sleep(5000)
      }
    }
  }

  stopGenerator() {
    this.isActive = false
  }
}
