/* eslint-disable no-case-declarations */
import path from 'path'
import { toWei } from 'web3-utils'
import fetch from 'node-fetch'

import { FullNode } from '@zkopru/core'
import { logger, sleep } from '@zkopru/utils'
import { ZkWallet } from '@zkopru/zk-wizard'
import { getBase, startLogger } from './generator-utils'
import { config } from './config'

startLogger(`./BLOCKTURNNER_LOG`)

// Block Turnner is for Zkopru layer 2 chain being continue by deposit tx with enough fee
async function runBlockTurner() {
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

  logger.info('Layer2 block turner Initializing')
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
  // Account #2 - Depositer
  const walletAccount = await hdWallet.createAccount(3)
  const depositerConfig = {
    wallet: hdWallet,
    account: walletAccount,
    accounts: [walletAccount],
    node: walletNode,
    erc20: [],
    erc721: [],
    snarkKeyPath: path.join(__dirname, '../../circuits/keys'),
  }

  const turnner = new ZkWallet(depositerConfig)
  turnner.node.start()
  turnner.setAccount(walletAccount)
  logger.info(`Depositer node start`)

  // depositer.node.layer1.web3.eth.getBalance(depositer)
  while (true) {
    try {
      const result = await turnner.depositEther(
        toWei('1', 'wei'),
        toWei('0.005'),
      )
      if (!result) {
        throw new Error('Deposit Transaction Failed!')
      }
    } catch (err) {
      logger.error(err)
    }
    await sleep(15000)
  }
}

runBlockTurner()
