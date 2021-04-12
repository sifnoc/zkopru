/* eslint-disable @typescript-eslint/camelcase */
import {
  ZkopruContract,
  TransactionObject,
  Tx,
  TxUtil,
} from '@zkopru/contracts'
import { Config } from '@zkopru/database'
import { Account, HttpProvider, TransactionReceipt } from 'web3-core'
import { hexify } from '@zkopru/utils'
import Web3 from 'web3'
import { ContractOptions } from 'web3-eth-contract'
import * as ffjs from 'ffjavascript'
import { soliditySha3 } from 'web3-utils'
import { verifyingKeyIdentifier, VerifyingKey } from '../snark/snark-verifier'

interface web3Extend extends Web3 {
  evm: {
    setAutomine: (arg: boolean) => any
    setIntervalMining: (arg: number) => any
    snapshot: () => number
    revert: (snapshotNumber: number) => boolean
    increaseBlockTime: (seconds: number) => {}
    setNextBlockTimestamp: (timestamp: number) => {}
  }
}

export class L1testChain {
  web3: web3Extend
  url: string
  miningInterval: number

  private lastSnapshot: number | null // How many attempt to take snapshot

  constructor(url: string, miningInterval?: number) {
    this.url = url
    this.miningInterval = miningInterval ?? 0 // Default 0 is mean that not start mining
    this.lastSnapshot = null

    // TODO: refactor these web3 extend.. name as web3-hardhat?
    const web3Extend = new Web3()

    web3Extend.setProvider(new Web3.providers.HttpProvider(url))

    web3Extend.extend({
      property: 'evm',
      methods: [
        {
          name: 'setAutomine',
          call: 'evm_setAutomine', // hardhat RPC method
          params: 1,
        },
        {
          name: 'setIntervalMining',
          call: 'evm_setIntervalMining', // // hardhat RPC method
          params: 1,
        },
        {
          name: 'snapshot',
          call: 'evm_snapshot',
          params: 0,
          // @ts-ignore
          outputFormatter: Web3.utils.hexToNumber,
        },
        {
          name: 'revert',
          call: 'evm_revert',
          params: 1,
          // @ts-ignore
          inputFormatter: [Web3.utils.numberToHex],
        },
        {
          name: 'increaseMineTime',
          call: 'evm_increaseTime',
          params: 1,
        },
        {
          name: 'setNextBlockTimestamp',
          call: 'evm_setNextBlockTimestamp',
          params: 1,
        },
      ],
    })

    this.web3 = web3Extend as web3Extend
  }

  async getCurrentSnapshot() {
    return this.lastSnapshot
  }

  // TODO: what are differences of get or set Interval

  get getInterval() {
    return this.miningInterval
  }

  setInterval(interval: number) {
    this.miningInterval = interval
    this.getInterval
  }

  async stopMine(): Promise<boolean> {
    const automineResult = await this.web3.evm.setAutomine(false)
    const intervalMiningResult = await this.web3.evm.setIntervalMining(0)
    console.log(
      `Result are automine = ${automineResult} intervalMining = ${intervalMiningResult}`,
    )
    return automineResult && intervalMiningResult == 0
  }

  startMine(interval: number = this.miningInterval) {
    this.web3.evm.setAutomine(true)
    this.web3.evm.setIntervalMining(interval)
    console.log('Start Mining')
  }

  async snapshot() {
    // TODO: make request 'evm_snapshot'
    // 1. stopMining
    // 2. check current blockNumber
    // 3. send snapshot call
    // 4. startMining

    // 3
    const snapshotCount = this.web3.evm.snapshot()
    this.lastSnapshot = snapshotCount
    return snapshotCount
  }

  async revert() {
    // TODO; make request 'evm_revert'
    // 1. stop mining (is mining or not)
    this.lastSnapshot = null
  }
}

export class L1Contract extends ZkopruContract {
  web3: Web3

  address: string

  config?: Config

  constructor(web3: Web3, address: string, option?: ContractOptions) {
    super(web3, address, option)
    this.web3 = web3
    this.address = address
  }

  async getVKs(): Promise<{ [txSig: string]: VerifyingKey }> {
    const NUM_OF_INPUTS = 4
    const NUM_OF_OUTPUTS = 4
    const vks: { [txSig: string]: VerifyingKey } = {}
    const tasks: (() => Promise<void>)[] = []
    const bn128 = await ffjs.buildBn128()
    // const stringify = (val: unknown) => BigInt(val).toString(10)
    for (let nI = 1; nI <= NUM_OF_INPUTS; nI += 1) {
      for (let nO = 1; nO <= NUM_OF_OUTPUTS; nO += 1) {
        tasks.push(async () => {
          const vk = await this.upstream.methods.getVk(nI, nO).call()
          const sig = verifyingKeyIdentifier(nI, nO)
          const vk_alpha_1 = [
            BigInt(vk.alpha1[0]),
            BigInt(vk.alpha1[1]),
            BigInt('1'),
          ]
          // caution: snarkjs G2Point is reversed
          const vk_beta_2 = [
            [BigInt(vk.beta2[0][1]), BigInt(vk.beta2[0][0])],
            [BigInt(vk.beta2[1][0]), BigInt(vk.beta2[1][1])],
            [BigInt('1'), BigInt('0')],
          ]
          const vk_gamma_2 = [
            [BigInt(vk.gamma2[0][1]), BigInt(vk.gamma2[0][0])],
            [BigInt(vk.gamma2[1][0]), BigInt(vk.gamma2[1][1])],
            [BigInt('1'), BigInt('0')],
          ]
          const vk_delta_2 = [
            [BigInt(vk.delta2[0][1]), BigInt(vk.delta2[0][0])],
            [BigInt(vk.delta2[1][0]), BigInt(vk.delta2[1][1])],
            [BigInt('1'), BigInt('0')],
          ]
          const vk_alphabeta_12 = bn128.pairing(
            bn128.G1.fromObject(vk_alpha_1),
            bn128.G2.fromObject(vk_beta_2),
          )
          const IC = vk.ic.map(ic => [BigInt(ic[0]), BigInt(ic[1]), BigInt(1)])
          vks[sig] = {
            protocol: 'groth',
            curve: 'bn128',
            nPublic: vk.ic.length - 1,
            vk_alpha_1,
            vk_beta_2,
            vk_gamma_2,
            vk_delta_2,
            vk_alphabeta_12,
            IC,
          }
        })
      }
    }
    await bn128.terminate()
    await Promise.all(tasks.map(task => task()))
    return vks
  }

  async getConfig(): Promise<Config> {
    if (this.config) return this.config
    let networkId!: number
    let chainId!: number
    let utxoTreeDepth!: number
    let withdrawalTreeDepth!: number
    let nullifierTreeDepth!: number
    let challengePeriod!: number
    let minimumStake!: string
    let referenceDepth!: number
    let maxUtxo!: string
    let maxWithdrawal!: string
    let utxoSubTreeDepth!: number
    let utxoSubTreeSize!: number
    let withdrawalSubTreeDepth!: number
    let withdrawalSubTreeSize!: number
    /** test start */
    /** test ends */
    const tasks = [
      async () => {
        networkId = await this.web3.eth.net.getId()
      },
      async () => {
        chainId = await this.web3.eth.getChainId()
      },
      async () => {
        utxoTreeDepth = parseInt(
          await this.upstream.methods.UTXO_TREE_DEPTH().call(),
          10,
        )
      },
      async () => {
        withdrawalTreeDepth = parseInt(
          await this.upstream.methods.WITHDRAWAL_TREE_DEPTH().call(),
          10,
        )
      },
      async () => {
        nullifierTreeDepth = parseInt(
          await this.upstream.methods.NULLIFIER_TREE_DEPTH().call(),
          10,
        )
      },
      async () => {
        challengePeriod = parseInt(
          await this.upstream.methods.CHALLENGE_PERIOD().call(),
          10,
        )
      },
      async () => {
        utxoSubTreeDepth = parseInt(
          await this.upstream.methods.UTXO_SUB_TREE_DEPTH().call(),
          10,
        )
      },
      async () => {
        utxoSubTreeSize = parseInt(
          await this.upstream.methods.UTXO_SUB_TREE_SIZE().call(),
          10,
        )
      },
      async () => {
        withdrawalSubTreeDepth = parseInt(
          await this.upstream.methods.WITHDRAWAL_SUB_TREE_DEPTH().call(),
          10,
        )
      },
      async () => {
        withdrawalSubTreeSize = parseInt(
          await this.upstream.methods.WITHDRAWAL_SUB_TREE_SIZE().call(),
          10,
        )
      },
      async () => {
        minimumStake = await this.upstream.methods.MINIMUM_STAKE().call()
      },
      async () => {
        referenceDepth = parseInt(
          await this.upstream.methods.REF_DEPTH().call(),
          10,
        )
      },
      async () => {
        maxUtxo = await this.upstream.methods.MAX_UTXO().call()
      },
      async () => {
        maxWithdrawal = await this.upstream.methods.MAX_WITHDRAWAL().call()
      },
    ]
    await Promise.all(tasks.map(task => task()))
    const zkopruId = soliditySha3(
      hexify(networkId, 32),
      hexify(chainId, 32),
      hexify(this.address, 20),
    )
    if (!zkopruId) throw Error('hash error to get zkopru id')
    this.config = {
      id: zkopruId,
      networkId,
      chainId,
      address: this.address,
      utxoTreeDepth,
      withdrawalTreeDepth,
      nullifierTreeDepth,
      utxoSubTreeDepth,
      utxoSubTreeSize,
      withdrawalSubTreeDepth,
      withdrawalSubTreeSize,
      challengePeriod,
      minimumStake,
      referenceDepth,
      maxUtxo,
      maxWithdrawal,
    }
    return this.config
  }

  async sendExternalTx<T>(
    tx: TransactionObject<T>,
    account: Account,
    to: string,
    option?: Tx,
  ): Promise<TransactionReceipt | undefined> {
    const receipt = await TxUtil.sendTx(tx, to, this.web3, account, option)
    return receipt
  }

  async sendTx<T>(
    tx: TransactionObject<T>,
    account: Account,
    option?: Tx,
  ): Promise<TransactionReceipt | undefined> {
    const result = await TxUtil.sendTx(
      tx,
      this.address,
      this.web3,
      account,
      option,
    )
    return result
  }
}
