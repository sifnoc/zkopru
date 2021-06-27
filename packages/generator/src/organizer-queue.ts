import { Job, Queue, QueueScheduler, Worker } from 'bullmq'
import { RawTx, ZkTx } from '@zkopru/transaction'
import { logger } from '~utils/logger'

export type ZkTxData = { tx: RawTx; zkTx: ZkTx }
export type ZkTxJob = Job<ZkTxData, any, string>
export type ZkTxQueue = Queue<ZkTxData, any, string>
export type ZkTxWorker = Worker<ZkTxData, any, string>

interface Queues {
  main: ZkTxQueue
  sub: { [key: string]: ZkTxQueue }
}

interface Workers {
  main: ZkTxWorker
  sub: { [key: string]: ZkTxWorker }
}

interface Schedulers {
  main: QueueScheduler
  sub: { [key: string]: QueueScheduler }
}

interface QueueRate {
  name?: string
  max: number
  duration?: number
}

interface OrganizerQueueConfig {
  connection: { host: string; port: number }
  rates: QueueRate[]
}

/*
Organizer Queue has two types of queue, 'main' and 'sub'.

The main queue always accepts ZkTx from the wallets,

then following the current rate, forwards to the 'sub' queue which has a worker with the rate-limiting.

Let assume that there are 2 sub queues, one has 10 tps rate, another one has 1 tps rate.

current selected 10 tps rate, the main queue is going to forward zktx to the sub queue which has 10 tps rate worker

- 10 tps rate
  Wallet1(ZkTx) → Main-Queue → Sub-Queue(10 tps rate) → Wallet1
  Wallet2(ZkTx) ⬈              Sub-Queue( 1 tps rate) ⬊ Wallet2

- 1 tps rate
  Wallet1(ZkTx) → Main-Queue   Sub-Queue(10 tps rate) ⬈ Wallet1
  Wallet2(ZkTx) ⬈            ⬊ Sub-Queue( 1 tps rate) → Wallet2

bullmq does not working with newly created queue or workers after initiated
*/
export class OrganizerQueue {
  private currentQueue: 'mainQueue' | string

  queues: Queues

  workers: Workers

  scheduler: Schedulers

  constructor(config: OrganizerQueueConfig) {
    const { connection } = config

    const subQueues = {}
    const subWorkers = {}
    const subScheduler = {}

    for (const rate of config.rates) {
      const queueName = rate.name ?? rate.max.toString()
      subQueues[queueName] = new Queue<ZkTxData, any, string>(queueName, {
        connection,
      })

      subWorkers[queueName] = new Worker<ZkTxData, any, string>(
        queueName,
        async (job: ZkTxJob) => {
          this.queues[queueName].add(job.name, job.data)
        },
        {
          limiter: { max: rate.max, duration: rate.duration ?? 1000 },
          connection,
        },
      )

      subScheduler[queueName] = new QueueScheduler(queueName, { connection })
    }

    this.currentQueue = 'mainQueue'

    this.queues = {
      main: new Queue('mainQueue'),
      sub: subQueues,
    }

    this.workers = {
      main: new Worker<ZkTxData, any, string>(
        'mainQueue',
        async (job: ZkTxJob) => {
          this.queues[this.currentQueue].add(job.name, job.data)
        },
        { connection },
      ),
      sub: subWorkers,
    }

    this.scheduler = {
      main: new QueueScheduler('mainQueue', { connection }),
      sub: subScheduler,
    }
  }

  currentRate() {
    if (this.currentQueue === 'mainQueue') {
      return 0
    }
    const currentLimiter = this.workers.sub[this.currentQueue].opts.limiter!
    return currentLimiter.max / currentLimiter?.duration
  }

  selectRate(queueName: string) {
    if (!Object.keys(this.queues.sub).includes(queueName)) {
      return new Error(`There are not exist the queueName ${queueName}`)
    }
    this.currentQueue = queueName
    return queueName
  }

  async jobsInQueue(queueName: string) {
    const jobCount = await this.queues.sub[queueName].getJobCounts(
      'wait',
      'active',
      'delayed',
    )
    return jobCount.wait + jobCount.active + jobCount.delayed
  }

  async allRemainingJobs() {
    let remainJobs = 0
    for (const queueName of Object.keys(this.queues.sub)) {
      remainJobs += await this.jobsInQueue(queueName)
    }
    return remainJobs
  }
}
