/* eslint-disable no-case-declarations */
import path from 'path'
import { toWei } from 'web3-utils'
import fetch from 'node-fetch'

import { FullNode } from '@zkopru/core'
import { logger, sleep } from '@zkopru/utils'
import { TransferGenerator } from './generator'
import { getBase, startLogger } from './generator-utils'
import { config } from './config'

startLogger(`./WALLET_LOG`)

async function runGenerator() {
  // Wait ready
  let ready = false
  logger.info(`Standby for zkopru contracts are ready`)
  while (!ready) {
    try {
      const readyResponse = await fetch(`http://organizer:8080/ready`, {
        method: 'get',
        timeout: 120,
      })
      ready = await readyResponse.json()
    } catch (error) {
      // logger.info(`Error checking organizer ready - ${error}`)
    }
    await sleep(5000)
  }

  logger.info('Wallet Initializing - get ID from organizer')
  const response = await fetch(`http://organizer:8080/register`, {
    method: 'post',
    body: JSON.stringify({
      role: 'wallet',
    }),
  })
  const registered = await response.json()

  logger.info(`Wallet selected account index ${registered.ID + 3}`)

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

  // Assume that account index 0, 1, 2 are reserved
  // Account #0 - Coordinator
  // Account #1 - Slasher
  // Account #2 - None
  const walletAccount = await hdWallet.createAccount(
    parseInt(registered.ID) + 3,
  )
  const transferGeneratorConfig = {
    hdWallet,
    db: mockupDB,
    account: walletAccount,
    node: walletNode,
    noteAmount: { eth: toWei('0.1'), fee: toWei('0.01') },
    erc20: [],
    erc721: [],
    snarkKeyPath: path.join(__dirname, '../../circuits/keys'),
    ID: registered.ID,
  }

  const generator = new TransferGenerator(transferGeneratorConfig)

  logger.info(`Start Generate Tansaction`)
  await generator.startGenerator()

  // setTimeout(async () => {
  //   logger.info('Stop Generator')
  //   await generator.stopGenerator()
  // }, 100000)
}

runGenerator()
