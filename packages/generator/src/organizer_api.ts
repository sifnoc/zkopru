import Web3 from 'web3'
import { Transaction, TransactionReceipt } from 'web3-core'
import AsyncLock from 'async-lock'
import express from 'express'
import { logger, sleep } from '@zkopru/utils'
import { logAll } from './generator-utils'
import { config } from './config'

interface TxSummary {
  [txHash: string]: {
    from: string
    funcSig: string
    inputSize: number
    gas: number
    gasUsed?: number
    success?: boolean
  }
}

interface CoordinatorUrls {
  [account: string]: string
}

interface CoordinatorData {
  from: string
  timestamp: number
  proposeNum: number
  txcount: number
  finalized?: boolean
}

interface WalletData {
  registeredId: number
  from?: string
}

interface GasData {
  from: string
  inputSize: number
  gasUsed?: number
}

interface OrganizerData {
  layer1?: {
    txSummaries: TxSummary[]
    gasTable: { [sig: string]: GasData[] }
  }
  coordinatorData?: CoordinatorData[]
  walletData?: WalletData[]
}

interface OrganizerContext {
  // Web3 and Coordinator L2?
  web3: Web3
  coordinators: CoordinatorUrls
}

interface OrganizerConfig {
  Port: number
}

export class OrganizerApi {
  context: OrganizerContext

  organizerData: OrganizerData

  config: OrganizerConfig

  walletLock: AsyncLock

  ready: boolean

  constructor(context: OrganizerContext, config?: OrganizerConfig) {
    this.context = context
    this.organizerData = {
      layer1: {
        txSummaries: [],
        gasTable: {},
      },
      coordinatorData: [],
      walletData: [],
    } // Initialize

    this.walletLock = new AsyncLock()

    this.ready = false

    this.config = config ?? { Port: 8080 } // TODO : more configuration
  }

  // TODO: create this method and variable purpose
  registerCoordinator(account: string, url: string) {
    this.context.coordinators[account] = url
  }

  registerWallet(account: string): number {
    // TODO : registering Wallet and return ID
    // TODO : use Async mutex when return ID

    // Already Initialized
    const lastRegistered = this.organizerData.walletData?.length
    logger.info(
      `Current length ${lastRegistered}, ${logAll(
        this.organizerData.walletData,
      )}`,
    )
    this.organizerData.walletData?.push({
      from: account,
      registeredId: (lastRegistered ?? 0) + 1,
    })

    logger.info(`account ${account} are registered`)
    return this.organizerData.walletData!.length
  }

  private async checkReady(contractAddr: string) {
    const { web3 } = this.context
    return web3.eth.subscribe('newBlockHeaders').on('data', async () => {
      const zkopruContractCode = await web3.eth.getCode(contractAddr)
      if (zkopruContractCode.length > 10000) {
        this.ready = true
      }
    })
  }

  private async watchLayer1block() {
    const { web3 } = this.context
    const { gasTable } = this.organizerData.layer1! // Initialized by constructor

    web3.eth.subscribe('newBlockHeaders').on('data', async function (data) {
      const blockData = await web3.eth.getBlock(data.hash)
      const txs: Promise<Transaction>[] = []
      const receipts: Promise<TransactionReceipt>[] = []
      if (blockData.transactions) {
        blockData.transactions.forEach(txHash => {
          txs.push(web3.eth.getTransaction(txHash))
          receipts.push(web3.eth.getTransactionReceipt(txHash))
        })
      }
      const txData = await Promise.all(txs)
      const receiptData = await Promise.all(receipts)

      // TODO : check necessary all tx should container this class
      const txSummary: TxSummary = {} as TxSummary

      // Exctract Data from fetched data
      blockData.transactions.forEach(txHash => {
        for (let i = 0; i < blockData.transactions.length; i++) {
          if (txData[i].hash == txHash) {
            const txdata = txData[i]
            const funcSig = txdata.input.slice(0, 10)
            txSummary[txHash] = {
              from: txdata.from,
              funcSig,
              inputSize: txdata.input.length,
              gas: txdata.gas,
            }
          }
          if (receiptData[i].transactionHash == txHash) {
            const receipt = receiptData[i]
            txSummary[txHash] = {
              ...txSummary[txHash],
              gasUsed: receipt.gasUsed,
              success: receipt.status,
            }
          }
        }
      })

      // Update Gas Table
      Object.keys(txSummary).forEach(txHash => {
        const data = txSummary[txHash]
        if (gasTable[data.funcSig] == undefined) {
          gasTable[data.funcSig] = [
            {
              from: data.from,
              inputSize: data.inputSize,
              gasUsed: data.gasUsed ?? 0,
            },
          ]
        } else {
          gasTable[data.funcSig].push({
            from: data.from,
            inputSize: data.inputSize,
            gasUsed: data.gasUsed ?? 0,
          })
        }
      })
    })
  }

  async start() {
    const readySubscribtion = await this.checkReady(config.zkopruContract)
    logger.info(`Waiting zkopru contracts are deployed`)
    while (this.ready == false) {
      await sleep(10000)
    }

    await readySubscribtion.unsubscribe((error, success) => {
      if (success) {
        logger.info(
          'successfully unsubscribe "ready", run block watcher and API server ',
        )
      }
      if (error) {
        logger.error(`failed to unsubscribe "ready" `)
      }
    })

    // Start Layer1 block watcher
    this.watchLayer1block()

    const app = express()

    app.use(express.text())
    app.get('/gastable', (_, res) => {
      res.send(this.organizerData.layer1?.gasTable)
    })
    app.get('/tps', (_, res) => {
      // let proposedData: CoordinatorData[] = []
      // const coordAddrs = Object.keys(this.organizerData.coordinators!) // Initialized at constructor

      let previousProposeTime: number
      if (this.organizerData.coordinatorData != []) {
        const response = this.organizerData.coordinatorData!.map(data => {
          if (data.proposeNum == 0) {
            previousProposeTime = data.timestamp
          }
          const duration = Math.floor(
            (data.timestamp - previousProposeTime) / 1000,
          )
          previousProposeTime = data.timestamp
          return {
            proposalNum: data.proposeNum,
            duration,
            txcount: data.txcount,
            tps: data.txcount / duration,
          }
        })
        res.send(response)
      } else {
        res.send(`Not yet proposed on Layer2`)
      }
    })
    app.get(`/ready`, async (_, res) => {
      res.send(this.ready)
    })
    // req : {role: 'wallet' | 'coordinator', account: string, url?: string}
    app.post('/register', async (req, res) => {
      let data
      try {
        // TODO : delete this term
        // logger.info(`register received req ${logAll(req)}`)
        data = JSON.parse(req.body)
        logger.info(`register received data ${data}`)
      } catch (err) {
        logger.error(err)
      }
      if (data.role == 'wallet') {
        const id = await this.walletLock.acquire('wallet', () => {
          return this.registerWallet(data.account ?? '0x0')
        })
        res.send({ ID: id })
      } else if (data.role == 'coordinator') {
        this.registerCoordinator(data.account, data.url)
      } else {
        res.status(400).send(`Need to role for register`)
      }
    })
    app.post('/propose', async (req, res) => {
      try {
        const data = JSON.parse(req.body)
        const { from, timestamp, proposed, txcount } = data
        this.organizerData.coordinatorData?.push({
          from,
          timestamp,
          proposeNum: proposed,
          txcount,
        })
        res.sendStatus(200)
      } catch (err) {
        res.status(500).send(`Organizer server error: ${err.toString()}`)
      }
    })
    // TODO : create metric endpoint
    app.get(`/metric`, async (_, res) => {
      return res.sendStatus(200)
    })
    app.listen(this.config.Port, () => {
      logger.info(`[Organizer] Server is running`)
    })
  }
}
