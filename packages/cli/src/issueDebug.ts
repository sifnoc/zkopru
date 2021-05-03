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
  // Account 1 - Validator?
  for (let i = 2; i < num + 2; i++) {
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

// Two deposit consequence are cause Tx revert
async function issueCase1() {
  logger.info('Issue Case 1 - two deposit transactions from same account')
  const { hdWallet, webSocketProvider } = await getProviders(
    testnet,
    mnemonic,
    'helloworld',
  )

  const accounts = await genAccounts(hdWallet, 5)

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

  if (wallet.node.isRunning()) {
    logger.info('Now is running')
    wallet.node.start()
  }
  sleep(5000)
  logger.info(`${wallet.accounts.length} accounts in Wallet`) // 5 accounts

  // 3. Start Deposit Tx with two accounts

  // 3-1. Send Deposit tx from account#3 0x22d...
  wallet.setAccount(2)

  const note1 = Utxo.newEtherNote({
    owner: accounts[2].zkAddress,
    eth,
  })

  const depositTx1 = await getDepositTx(wallet, note1, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[2].ethAddress} sent deposit Tx`)
  try {
    const receipt1 = await wallet.node.layer1.sendTx(
      depositTx1,
      accounts[2].ethAccount,
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

  const note2 = Utxo.newEtherNote({
    owner: accounts[2].zkAddress,
    eth,
  })

  const depositTx2 = await getDepositTx(wallet, note2, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[2].ethAddress} sent deposit Tx`)
  try {
    const receipt2 = await wallet.node.layer1.sendTx(
      depositTx2,
      accounts[2].ethAccount,
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

// Two deposit consequence are cause Tx revert
async function issueCase2() {
  logger.info('Issue Case 2 - two deposit transactions from diffrent accounts')
  const { hdWallet, webSocketProvider } = await getProviders(
    testnet,
    mnemonic,
    'helloworld',
  )

  const accounts = await genAccounts(hdWallet, 5)

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

  if (wallet.node.isRunning()) {
    logger.info('Now is running')
    wallet.node.start()
  }
  sleep(5000)
  logger.info(`${wallet.accounts.length} accounts in Wallet`) // 5 accounts

  // 3. Start Deposit Tx with two accounts
  // 3-1. Send Deposit tx from account#3
  wallet.setAccount(2)

  const note1 = Utxo.newEtherNote({
    owner: accounts[2].zkAddress,
    eth,
  })

  const depositTx1 = await getDepositTx(wallet, note1, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[2].ethAddress} sent deposit Tx`)
  try {
    const receipt1 = await wallet.node.layer1.sendTx(
      depositTx1,
      accounts[2].ethAccount,
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
  wallet.setAccount(3)

  const note2 = Utxo.newEtherNote({
    owner: accounts[3].zkAddress,
    eth,
  })

  const depositTx2 = await getDepositTx(wallet, note2, Fp.strictFrom(fee))

  logger.info(`Account ${accounts[3].ethAddress} sent deposit Tx`)
  try {
    const receipt2 = await wallet.node.layer1.sendTx(
      depositTx2,
      accounts[2].ethAccount,
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

  // TODO :
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

  // TODO : Fix update
  const snapshotCount = await web3extend.evm.snapshot()
  const snapshotBlockNUmber = await web3extend.eth.getBlockNumber()
  logger.info(`Snapshot at ${snapshotCount} `)

  await issueCase1()

  logger.info(
    `Issue Case 1 complete - back to snapshot from ${await web3.eth.getBlockNumber()} to ${snapshotBlockNUmber}`,
  )
  const rollBack = await web3extend.evm.revert(1)
  logger.info(`Snapshot at ${rollBack} `)
  logger.info(`Current block Number is ${await web3.eth.getBlockNumber()}`)

  sleep(2000)
  await issueCase2()
  logger.info(
    `Issue Case 2 complete - back to snapshot from ${await web3.eth.getBlockNumber()}`,
  )
  const rollBack2 = await web3extend.evm.revert(0)
  logger.info(`Snapshot at ${rollBack2} `)
  logger.info(`Current block Number is ${await web3.eth.getBlockNumber()}`)
}

main()
