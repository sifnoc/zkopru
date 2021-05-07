/* eslint-disable no-case-declarations */
import fs from 'fs'
import path from 'path'
import util from 'util'
import Web3 from 'web3'
import { toWei } from 'web3-utils'
import { Transform } from 'stream'

import { F, Fp } from '@zkopru/babyjubjub'
import { Note, Utxo } from '@zkopru/transaction'
import { FullNode } from '@zkopru/core'
import { ZkWallet } from '@zkopru/zk-wizard'
import { ZkAccount, HDWallet } from '@zkopru/account'
import { Coordinator } from '@zkopru/coordinator'
import { SQLiteConnector, schema } from '@zkopru/database/dist/node'
import { logStream, logger, sleep } from '@zkopru/utils'
import prettier from 'pino-pretty'
import { PayableTx } from '~contracts/contracts/types'

// Config Params
const testnet = 'ws://testnet:5000'
const mnemonic =
  'myth like bonus scare over problem client lizard pioneer submit female collect'
const zkopruContract = '0x970e8f18ebfEa0B08810f33a5A40438b9530FBCF'

const eth: F = toWei('0.01', 'ether')
const fee: F = toWei('0.001', 'ether')

// helper functions
export async function getProviders(
  url: string,
  mnemonic: string,
  password: string,
) {
  const webSocketProvider = new Web3.providers.WebsocketProvider(url, {
    reconnect: { auto: true },
  })

  // callback function for ws connection
  async function awaitConnection() {
    return new Promise<void>(res => {
      if (webSocketProvider.connected) return res()
      webSocketProvider.on('connect', res)
    })
  }

  webSocketProvider.connect() // send connection to Layer1
  await awaitConnection()

  // Create Wallet
  const mockup = await SQLiteConnector.create(schema, ':memory:')
  const web3 = new Web3(webSocketProvider)
  const hdWallet = new HDWallet(web3, mockup)

  await hdWallet.init(mnemonic, password) //

  return { hdWallet, webSocketProvider }
}

export async function genAccounts(hdWallet: HDWallet, num: number) {
  const accounts: ZkAccount[] = []

  // Account 0 - Coordinator
  // Account 1 - Validator
  for (let i = 0; i < num; i++) {
    const account = await hdWallet.createAccount(i)
    accounts.push(account)
  }
  return accounts
}

export async function getDepositTx(wallet, note: Note, fee: F) {
  // TODO: set Type
  const { deposit } = wallet.node.layer1.user.methods
  const tx = deposit(
    note.owner.spendingPubKey().toString(),
    note.salt.toUint256().toString(),
    note
      .eth()
      .toUint256()
      .toString(),
    note
      .tokenAddr()
      .toAddress()
      .toString(),
    note
      .erc20Amount()
      .toUint256()
      .toString(),
    note
      .nft()
      .toUint256()
      .toString(),
    fee.toString(),
  )

  return tx
}

// @ts-ignore
async function Case0(web3: Web3) {
  logger.info(
    'Case 0 - two deposit transactions from same account with interval',
  )
  const { hdWallet, webSocketProvider } = await getProviders(
    testnet,
    mnemonic,
    'helloworld',
  )

  const accounts = await genAccounts(hdWallet, 6)

  const coordinatorMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const node: FullNode = await FullNode.new({
    address: zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: coordinatorMockupDB,
    slasher: accounts[1].ethAccount,
  })

  const coordinatorAccount = accounts[0].ethAccount

  const coordinatorConfig = {
    bootstrap: true,
    address: zkopruContract,
    maxBytes: 131072,
    maxBid: 20000,
    vhosts: 'localhost,127.0.0.1',
    priceMultiplier: 48,
    port: 8888,
  }

  logger.info('Node Start >> ', node.start())

  const coordinator = new Coordinator(
    node,
    coordinatorAccount,
    coordinatorConfig,
  )

  // 1. Run coordinator
  await coordinator.start()

  const events = ['start', 'stop']
  events.forEach(event => {
    coordinator.on(event, res => logger.info(`Coordinator [${event}] >`, res))
  })

  // 2. Get Wallet
  const walletMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const wallet = new ZkWallet({
    db: walletMockupDB,
    wallet: hdWallet,
    node,
    accounts,
    erc20: [],
    erc721: [],
    coordinator: 'http://localhost:8888',
    snarkKeyPath: path.join(__dirname, '../../circuits/keys'),
  })

  logger.info(`Wallet node is running? ${wallet.node.isRunning().valueOf()}`)

  if (!wallet.node.isRunning()) {
    logger.info('Now is running')
    wallet.node.start()
  }
  await sleep(1000)
  logger.info(`${wallet.accounts.length} accounts in Wallet`) // 6 accounts

  // 3. Start Deposit Tx with two accounts

  // 3-1. Send Deposit tx from account#4 0xd03..
  wallet.setAccount(accounts[4])

  const note1 = Utxo.newEtherNote({
    owner: accounts[4].zkAddress,
    eth,
  })

  const depositTx1 = await getDepositTx(wallet, note1, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[4].ethAddress} sent deposit Tx`)
  try {
    const receipt1 = await wallet.node.layer1.sendTx(
      depositTx1,
      accounts[4].ethAccount,
      {
        value: note1
          .eth()
          .add(fee)
          .toString(),
      },
    )
    logger.info(
      `Receipt >> ${util.inspect(receipt1, { showHidden: true, depth: null })}`,
    )
  } catch (err) {
    logger.error(err)
  }

  node.layer1.coordinator.events.MassDepositCommit(md => {
    logger.info('MassDeposit Committed >> ', md)
  })

  // Wait coordinator's committedDeposit Tx
  logger.info("Wait for coordinator's commitDeposit Tx")
  const latestCoordinatorTxCount = await web3.eth.getTransactionCount(
    accounts[0].ethAddress,
  )

  for (let i = 0; i < 30; i++) {
    if (
      latestCoordinatorTxCount !==
      (await web3.eth.getTransactionCount(accounts[0].ethAddress))
    ) {
      break
    }
    await sleep(1000)
  }

  // 3-2. Send Deposit tx from account#4 0xd03ea8624C8C5987235048901fB614fDcA89b117
  const note2 = Utxo.newEtherNote({
    owner: accounts[4].zkAddress,
    eth,
  })

  const depositTx2 = await getDepositTx(wallet, note2, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[4].ethAddress} sent deposit Tx`)
  try {
    const receipt2 = await wallet.node.layer1.sendTx(
      depositTx2,
      accounts[4].ethAccount,
      {
        value: note2
          .eth()
          .add(fee)
          .toString(),
      },
    )
    logger.info(
      `Receipt >>  ${util.inspect(receipt2, {
        showHidden: true,
        depth: null,
      })}`,
    )
    if (!receipt2?.status) {
      logger.warn('Second deposit Tx reverted!')
    }
  } catch (err) {
    logger.error(err)
  }

  wallet.node.stop() // node stop
  coordinator.stop()
}
// @ts-ignore
async function Case1() {
  logger.info('Case 1 - two deposit transactions from same account')
  const { hdWallet, webSocketProvider } = await getProviders(
    testnet,
    mnemonic,
    'helloworld',
  )

  const accounts = await genAccounts(hdWallet, 6)

  const coordinatorMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const node: FullNode = await FullNode.new({
    address: zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: coordinatorMockupDB,
    slasher: accounts[1].ethAccount,
  })

  const coordinatorAccount = accounts[0].ethAccount

  const coordinatorConfig = {
    bootstrap: true,
    address: zkopruContract,
    maxBytes: 131072,
    maxBid: 20000,
    vhosts: 'localhost,127.0.0.1',
    priceMultiplier: 48,
    port: 8888,
  }

  logger.info('Node Start >> ', node.start())

  const coordinator = new Coordinator(
    node,
    coordinatorAccount,
    coordinatorConfig,
  )

  // 1. Run coordinator
  await coordinator.start()

  const events = ['start', 'stop']
  events.forEach(event => {
    coordinator.on(event, res => logger.info(`Coordinator [${event}] >`, res))
  })

  // 2. Get Wallet
  const walletMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const wallet = new ZkWallet({
    db: walletMockupDB,
    wallet: hdWallet,
    node,
    accounts,
    erc20: [],
    erc721: [],
    coordinator: 'http://localhost:8888',
    snarkKeyPath: path.join(__dirname, '../../circuits/keys'),
  })

  logger.info(`Wallet node is running? ${wallet.node.isRunning().valueOf()}`)

  if (!wallet.node.isRunning()) {
    logger.info('Now is running')
    wallet.node.start()
  }
  await sleep(1000)
  logger.info(`${wallet.accounts.length} accounts in Wallet`) // 5 accounts

  // 3. Start Deposit

  // 3-1. Send Deposit tx from account#4 0xd03ea8624C8C5987235048901fB614fDcA89b117
  wallet.setAccount(accounts[4])

  const note1 = Utxo.newEtherNote({
    owner: accounts[4].zkAddress,
    eth,
  })

  const depositTx1 = await getDepositTx(wallet, note1, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[4].ethAddress} sent deposit Tx`)
  try {
    const receipt1 = await wallet.node.layer1.sendTx(
      depositTx1,
      accounts[4].ethAccount,
      {
        value: note1
          .eth()
          .add(fee)
          .toString(),
      },
    )
    logger.info(
      `Receipt >> ${util.inspect(receipt1, { showHidden: true, depth: null })}`,
    )
  } catch (err) {
    logger.error(err)
  }

  // 3-2. Send Deposit tx from account#4 0xd03ea8624C8C5987235048901fB614fDcA89b117
  wallet.setAccount(accounts[4])

  const note2 = Utxo.newEtherNote({
    owner: accounts[4].zkAddress,
    eth,
  })

  const depositTx2 = await getDepositTx(wallet, note2, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[4].ethAddress} sent deposit Tx`)
  try {
    const receipt2 = await wallet.node.layer1.sendTx(
      depositTx2,
      accounts[4].ethAccount,
      {
        gasPrice: 20000000000,
        gas: 400000,
        value: note2
          .eth()
          .add(fee)
          .toString(),
      } as PayableTx,
    )
    logger.info(
      `Receipt >>  ${util.inspect(receipt2, {
        showHidden: true,
        depth: null,
      })}`,
    )
    if (!receipt2?.status) {
      logger.warn('Second deposit Tx reverted!')
    }
  } catch (err) {
    logger.error(err)
  }

  wallet.node.stop() // node stop
  coordinator.stop()
}
// @ts-ignore
async function Case2(web3: Web3) {
  logger.info('Case 2 - two deposit transactions from diffrent accounts')
  const { hdWallet, webSocketProvider } = await getProviders(
    testnet,
    mnemonic,
    'helloworld',
  )

  const accounts = await genAccounts(hdWallet, 6)

  const coordinatorMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const node: FullNode = await FullNode.new({
    address: zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: coordinatorMockupDB,
    slasher: accounts[1].ethAccount,
  })

  const coordinatorAccount = accounts[0].ethAccount

  const coordinatorConfig = {
    bootstrap: true,
    address: zkopruContract,
    maxBytes: 131072,
    maxBid: 20000,
    vhosts: 'localhost,127.0.0.1',
    priceMultiplier: 48,
    port: 8888,
  }

  logger.info('Node Start >> ', node.start())

  const coordinator = new Coordinator(
    node,
    coordinatorAccount,
    coordinatorConfig,
  )

  // 1. Run coordinator
  await coordinator.start()

  const events = ['start', 'stop']
  events.forEach(event => {
    coordinator.on(event, res => logger.info(`Coordinator [${event}] >`, res))
  })

  // 2. Get Wallet
  const walletMockupDB = await SQLiteConnector.create(schema, ':memory:')
  const wallet = new ZkWallet({
    db: walletMockupDB,
    wallet: hdWallet,
    node,
    accounts,
    erc20: [],
    erc721: [],
    coordinator: 'http://localhost:8888',
    snarkKeyPath: path.join(__dirname, '../../circuits/keys'),
  })

  logger.info(`Wallet node is running?, ${wallet.node.isRunning().valueOf()}`)

  if (!wallet.node.isRunning()) {
    logger.info('Now is running')
    wallet.node.start()
  }
  await sleep(1000)
  logger.info(`${wallet.accounts.length} accounts in Wallet`) // 5 accounts

  // 3. Start Deposit Tx with two accounts

  // 3-1. Send Deposit tx from account#4 0xd03ea8624C8C5987235048901fB614fDcA89b117
  wallet.setAccount(accounts[4])
  logger.info(`Set Wallet Account to ${wallet.account}`)

  const note1 = Utxo.newEtherNote({
    owner: accounts[4].zkAddress,
    eth,
  })

  const depositTx1 = await getDepositTx(wallet, note1, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[4].ethAddress} sent deposit Tx`)
  try {
    const receipt1 = await wallet.node.layer1.sendTx(
      depositTx1,
      accounts[4].ethAccount,
      {
        value: note1
          .eth()
          .add(fee)
          .toString(),
      },
    )
    logger.info(
      `Receipt >> ${util.inspect(receipt1, { showHidden: true, depth: null })}`,
    )
  } catch (err) {
    logger.error(err)
  }

  // 3-2. Send Deposit tx from account#5 0x95cED938F7991cd0dFcb48F0a06a40FA1aF46EBC
  wallet.setAccount(accounts[5])

  const note2 = Utxo.newEtherNote({
    owner: accounts[5].zkAddress,
    eth,
  })

  const depositTx2 = await getDepositTx(wallet, note2, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[5].ethAddress} sent deposit Tx`)

  const txOption: PayableTx = {
    gasPrice: 40000000000,
    gas: 1000000,
    value: note2
      .eth()
      .add(fee)
      .toString(),
  }

  try {
    const receipt2 = await wallet.node.layer1.sendTx(
      depositTx2,
      accounts[5].ethAccount,
      txOption,
    )
    logger.info(
      `Receipt >>  ${util.inspect(receipt2, {
        showHidden: true,
        depth: null,
      })}`,
    )
    if (!receipt2?.status) {
      logger.warn('Second deposit Tx reverted!')
    }
  } catch (err) {
    logger.error(err)
  }

  wallet.node.stop() // node stop
  coordinator.stop()
}

async function main() {
  const writeStream = fs.createWriteStream('./ISSUE_LOG')
  logStream.addStream(writeStream)
  const pretty = prettier({
    translateTime: false,
    colorize: true,
  })
  const prettyStream = new Transform({
    transform: (chunk, _, cb) => {
      cb(null, pretty(JSON.parse(chunk.toString())))
    },
  })
  prettyStream.pipe(process.stdout)
  logStream.addStream(prettyStream)

  // 0. Set Provider and Take Snapshot on testnet
  const httpProvider = new Web3.providers.HttpProvider('http://testnet:5000', {
    timeout: 120,
  })
  const web3 = new Web3(httpProvider)
  const web3extend = web3.extend({
    property: 'evm',
    methods: [
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
    ],
  })

  // 1. Run deposit scenarios,
  //    case0 - Two deposit txs with committedDposit Tx between the two deposit Tx
  //    case1 - Two deposit txs from different accounts
  //    case2 - Two deposit txs from same acccount

  const snapshotBlockNUmber = await web3extend.eth.getBlockNumber()
  await web3extend.evm.snapshot()
  logger.info(`Snapshot at block ${snapshotBlockNUmber}`)

  logger.info(`Case 0 - Start`)
  await sleep(1000)
  await Case0(web3)
  logger.info(
    `Case 0 complete - rollback to snapshot from ${await web3.eth.getBlockNumber()} to ${snapshotBlockNUmber}`,
  )

  // RollBack
  const rollBack0 = await web3extend.evm.revert(1)
  logger.info(`Reverted ? ${rollBack0}`)
  await web3extend.evm.snapshot()
  const snapshotBlockNUmber1 = await web3extend.eth.getBlockNumber()
  logger.info(`Snapshot at block ${snapshotBlockNUmber1}`)
  logger.info(`Current block Number is ${await web3.eth.getBlockNumber()}`)

  logger.info(`Case 1 - Start`)
  await sleep(1000)
  await Case1()
  logger.info(
    `Case 1 complete - rollback to snapshot from ${await web3.eth.getBlockNumber()} to ${snapshotBlockNUmber1}`,
  )

  // RollBack
  const rollBack1 = await web3extend.evm.revert(1)
  logger.info(`Reverted ? ${rollBack1}`)
  logger.info(`Current block Number is ${await web3.eth.getBlockNumber()}`)

  logger.info(`Case 2 - Start`)
  await sleep(1000)
  await Case2(web3)
  logger.info(`Case 2 complete - End of issue reproduction`)
}

main()
