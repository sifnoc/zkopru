/* eslint-disable no-case-declarations */
import fs from 'fs'
import util from 'util'
import Web3 from 'web3'
import prettier from 'pino-pretty'
import { Transform } from 'stream'
import { networkInterfaces } from 'os'

import { F, Fp, Point } from '@zkopru/babyjubjub'
import {
  Note,
  Utxo,
  RawTx,
  ZkTx,
  UtxoStatus,
  ZkAddress,
} from '@zkopru/transaction'
import { HDWallet, ZkAccount } from '@zkopru/account'
import { logger, logStream } from '@zkopru/utils'
import { SQLiteConnector, schema } from '@zkopru/database/dist/node'
import { ZkWallet } from '~zk-wizard/zk-wallet'

// helper functions
export async function getBase(url: string, mnemonic: string, password: string) {
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
  const mockupDB = await SQLiteConnector.create(schema, ':memory:')
  const web3 = new Web3(webSocketProvider)
  const hdWallet = new HDWallet(web3, mockupDB)

  await hdWallet.init(mnemonic, password) //

  return { hdWallet, mockupDB, webSocketProvider }
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

export function logAll(Object) {
  return util.inspect(Object, {
    showHidden: true,
    depth: null,
  })
}

export function startLogger(fileName: string) {
  const writeStream = fs.createWriteStream(`/${fileName}`)
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
}

// TODO: get fency current Coodinator Ip
export function getLocalIP() {
  const nets = networkInterfaces()
  const net = nets.eth0
  let result = ''

  if (net) {
    result = net[0]?.address
  } else {
    throw new Error(`eth0 does not detected`)
  }
  return result
}

// TODO: create get only UserNote
export async function getEthUtxo(wallet: ZkWallet, account: ZkAccount) {
  const unSpentUtxo = await wallet.db.findMany('Utxo', {
    where: {
      owner: [account.zkAddress.toString()],
      status: UtxoStatus.UNSPENT,
      usedAt: null,
    },
  })
  return unSpentUtxo
}

/* eslint-disable @typescript-eslint/no-use-before-define */
// TODO : replace db or something
export function fileToZkTx(filename: string) {
  const { rawTx, rawZkTx } = JSON.parse(fs.readFileSync(filename).toString())
  return jsonToZkTx(rawTx, rawZkTx)
}

export function jsonToZkTx(rawTx, rawZkTx) {
  const tx = getTx(rawTx)
  const zkTx = getZkTx(rawZkTx)

  return { tx, zkTx }
}

export function getTx(rawTx) {
  logger.info(`getTx >> restructured tx from rawTx`)
  if (rawTx === undefined) {
    throw Error(`rawTx is undefined, please check queue data`)
  }
  const owner = ZkAddress.from(
    Fp.from(rawTx.inflow[0].owner.PubSK),
    Point.from(rawTx.inflow[0].owner.N.x, rawTx.inflow[0].owner.N.y),
  )

  const tx: RawTx = {
    inflow: rawTx.inflow.map(flow => {
      return new Utxo(
        owner,
        Fp.from(flow.salt),
        {
          eth: Fp.from(flow.eth),
          tokenAddr: Fp.from(flow.tokenAddr),
          erc20Amount: Fp.from(flow.erc20Amount),
          nft: Fp.from(flow.asset.nft),
        },
        flow.status,
      )
    }),
    outflow: rawTx.outflow.map(flow => {
      return new Utxo(
        owner,
        Fp.from(flow.salt),
        {
          eth: Fp.from(flow.eth),
          tokenAddr: Fp.from(flow.tokenAddr),
          erc20Amount: Fp.from(flow.erc20Amount),
          nft: Fp.from(flow.asset.nft),
        },
        flow.status,
      )
    }),
    fee: Fp.from(rawTx.fee),
  }
  logger.info(`>> resturectured tx is ${logAll(tx)}`)
  return tx
}

export function getZkTx(rawZkTx) {
  const zkTx = new ZkTx({
    inflow: rawZkTx.inflow.map(flow => {
      return {
        nullifier: Fp.from(flow.nullifier),
        root: Fp.from(flow.root),
      }
    }),
    outflow: [
      {
        note: Fp.from(rawZkTx.outflow[0].note),
        outflowType: Fp.from(rawZkTx.outflow[0].outflowType),
      },
      {
        note: Fp.from(rawZkTx.outflow[1].note),
        outflowType: Fp.from(rawZkTx.outflow[1].outflowType),
      },
    ],
    fee: Fp.from(rawZkTx.fee),
    proof: {
      pi_a: [
        Fp.from(rawZkTx.proof.pi_a[0]),
        Fp.from(rawZkTx.proof.pi_a[1]),
        Fp.from(rawZkTx.proof.pi_a[2]),
      ],
      pi_b: [
        [Fp.from(rawZkTx.proof.pi_b[0][0]), Fp.from(rawZkTx.proof.pi_b[0][1])],
        [Fp.from(rawZkTx.proof.pi_b[1][0]), Fp.from(rawZkTx.proof.pi_b[1][1])],
        [Fp.from(rawZkTx.proof.pi_b[2][0]), Fp.from(rawZkTx.proof.pi_b[2][1])],
      ],
      pi_c: [
        Fp.from(rawZkTx.proof.pi_c[0]),
        Fp.from(rawZkTx.proof.pi_c[1]),
        Fp.from(rawZkTx.proof.pi_c[2]),
      ],
    },
    memo: Buffer.from(rawZkTx.memo.toString(), 'base64'), // Buffer
  })
  return zkTx
}
