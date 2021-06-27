import { Job, Queue, QueueScheduler, Worker } from 'bullmq'
import { RawTx, ZkTx } from '@zkopru/transaction'

export type ZkTxData = { tx: RawTx; zkTx: ZkTx }

export type ZkTxJob = Job<ZkTxData, any, string>

interface Queues {
  main: Queue<ZkTxData, any, string>
  sub: { [key: string]: Queue<ZkTxData, any, string> }
  wallet: { [key: string]: Worker<ZkTxData, any, string> }
}

interface QueueRate {
  name?: string
  max: number
  duration?: number
}

interface OrganizerQueueConfig {
  connection: { host: string; port: number }
  rates: QueueRate[]
  wallets: string[]
}

/*
Organizer Queue has Rate Limiter as 'SubQueue'

Main queue always accepts ZkTx from the wallets

Then forwards to 'Sub' queue which has a worker with rate limiting.

Wallet(ZkTx) -> Main -> Sub(selected) -> WalletQueue -> WalletWorker

*/
export class OrganizerQueue {
  queues: Queues

  constructor(config: OrganizerQueueConfig) {
    const { connection } = config

    const subQueues = {}
    const subScheduler: QueueScheduler[] = []
    config.rates.forEach(rate => {
      const name = rate.name ?? rate.max.toString()
      subQueues[name] = new Queue<ZkTxData, any, string>(name, { connection })
      subScheduler.push(new QueueScheduler(name, { connection }))
    })
    const walletQueue = {}
    config.wallets.forEach(wallet => {
      walletQueue[wallet] = new Queue<ZkTxData, any, string>(wallet, {
        connection,
      })
      subScheduler.push(new QueueScheduler(wallet, { connection }))
    })

    this.queues = {
      main: new Queue('mainQueue'),
      sub: subQueues,
      wallet: walletQueue,
    }
  }

  // // Generate keys
  // const subQueueWorker = {}
  // for (let i = 0; i < config.rates.length; i++) {
  //   const limiter = config.rates[i]
  //   const name = limiter.name ?? limiter.max.toString()
  //   subQueueWorker[name] = new Worker(name, {limiter: {max: limiter.max, duration: limiter.duration ?? 1000}})
  // }
}
