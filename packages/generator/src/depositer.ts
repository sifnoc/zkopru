/* eslint-disable no-case-declarations */
import path from 'path'
import { toWei } from 'web3-utils'

import { FullNode } from '@zkopru/core'
import { logger, sleep } from '@zkopru/utils'
import { ZkWallet } from '@zkopru/zk-wizard'
import { getBase, startLogger } from './generator-utils'
import { config } from './config'

startLogger(`./DEPOSITER_LOG`)

async function runDepositer() {
  logger.info('Depositer Initializing')

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
  const walletAccount = await hdWallet.createAccount(2)
  const depositerConfig = {
    wallet: hdWallet,
    accounts: [walletAccount],
    node: walletNode,
    erc20: [],
    erc721: [],
    snarkKeyPath: path.join(__dirname, '../../circuits/keys')
  }

  const depositer = new ZkWallet(depositerConfig)
  depositer.node.start()
  logger.info(`Depositer node start`)

  // depositer.node.layer1.web3.eth.getBalance(depositer)
  while (true) {
    try {
      const result = await depositer.depositEther(
        toWei('1', 'wei'), toWei('0.01')
      )
      if (!result) {
        throw new Error('Deposit Transaction Failed!')
      }
    } catch (err) {
      logger.error(err)
    }
    await sleep(10000)
  }
}

runDepositer()
