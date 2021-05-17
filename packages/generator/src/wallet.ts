/* eslint-disable no-case-declarations */
import BN from 'bn.js'
import { toWei } from 'web3-utils'

import { FullNode } from '@zkopru/core'
import { TxBuilder, UtxoStatus, Utxo, RawTx } from '@zkopru/transaction'
import { logger, sleep } from '@zkopru/utils'
import { ZkWallet } from '~zk-wizard'
import { getBase, startLogger } from './baseGenerator'
import { config } from './config'

const eth: string = toWei('10000000000000000', 'wei')
const fee: string = toWei('5000000000000000', 'wei')

startLogger('./WALLET_LOG')

async function testWallet() {
  logger.info('Wallet Initializing')
  const { hdWallet, mockupDB, webSocketProvider } = await getBase(
    config.testnetUrl,
    config.mnemonic,
    'helloworld',
  )

  const walletNode: FullNode = await FullNode.new({
    provider: webSocketProvider,
    address: config.zkopruContract, // Zkopru contract
    db: mockupDB,
    accounts: [],
  })

  const walletAccount = await hdWallet.createAccount(4) // TODO: select from docker-compose config

  const wallet = new ZkWallet({
    db: mockupDB,
    wallet: hdWallet,
    node: walletNode,
    accounts: [walletAccount],
    erc20: [],
    erc721: [],
    snarkKeyPath: '/proj/packages/circuits/keys', // TODO: make more flexible
  })

  logger.info(`Wallet node start`)
  wallet.node.start()

  let depositCounter = 0

  // Create Eth note until proposed
  while (depositCounter < 100) {
    try {
      const result = await wallet.depositEther(
        eth,
        fee,
        walletAccount.zkAddress,
      )
      if (!result) {
        throw new Error('[Wallet] Deposit Transaction Failed!')
      }
    } catch (err) {
      logger.error(err)
    }
    await sleep(12000 + depositCounter * 1000)

    if (wallet.node.synchronizer.latestProcessed) break

    depositCounter += 1
  }

  // Ready to send Transfer
  let txBuilder: TxBuilder
  let spendables: Utxo[]
  let unspentUTXO: Utxo[]
  let spendingUTXO: Utxo[]
  let spentUTXO: Utxo[]
  let tx: RawTx
  let Counter = 1

  const weiPrice = toWei('4000', 'gwei') // TODO: make it flexible

  while (true) {
    unspentUTXO = await wallet.getUtxos(walletAccount, UtxoStatus.UNSPENT)

    if (unspentUTXO.length === 0) {
      logger.info('No Spendable Utxo, send Deposit Tx')
      try {
        const result = await wallet.depositEther(
          eth,
          fee,
          walletAccount.zkAddress,
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

    spendables = await wallet.getSpendables(walletAccount)

    txBuilder = TxBuilder.from(walletAccount.zkAddress)

    tx = txBuilder
      .provide(...spendables.map(note => Utxo.from(note)))
      .weiPerByte(weiPrice)
      .sendEther({
        eth: new BN(eth).div(new BN(2)),
        to: walletAccount.zkAddress,
      })
      .build()

    try {
      await wallet.sendTx({
        tx,
        from: walletAccount,
        encryptTo: walletAccount.zkAddress,
      })
    } catch (err) {
      logger.error(err)
      logger.error(tx)
    }

    // TODO: Make push at once, if this log necessary
    spentUTXO = await wallet.getUtxos(walletAccount, UtxoStatus.SPENT)
    unspentUTXO = await wallet.getUtxos(walletAccount, UtxoStatus.UNSPENT)
    spendingUTXO = await wallet.getUtxos(walletAccount, UtxoStatus.SPENDING)
    logger.info(
      `After send Tx UTXOs, 'unpent : ${unspentUTXO.length}', 'spending : ${spendingUTXO.length}', 'spent : ${spentUTXO.length}'`,
    )
    Counter += 1
  }
}

async function main() {
  await testWallet()
}

main()
