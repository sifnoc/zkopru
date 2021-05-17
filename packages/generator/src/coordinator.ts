/* eslint-disable no-case-declarations */
import { FullNode } from '@zkopru/core'
import { Coordinator } from '@zkopru/coordinator'
import { logger } from '@zkopru/utils'
import { config } from './config'
import { getBase, getLocalIP, startLogger } from './baseGenerator'

startLogger('COORDINATOR_LOG')

async function testCoodinator() {
  logger.info('Run Test Coodinator')
  const { hdWallet, mockupDB, webSocketProvider } = await getBase(
    config.testnetUrl,
    config.mnemonic,
    'helloworld',
  )

  const coordinatorAccount = await hdWallet.createAccount(0)
  const slaherAccount = await hdWallet.createAccount(1)

  const fullNode: FullNode = await FullNode.new({
    address: config.zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: mockupDB,
    slasher: slaherAccount.ethAccount,
  })

  // TODOMight possible error when modified `docker-compose` or `docker` configuration
  const coordinatorIp = getLocalIP() // TODO: Get fency ip address get

  const coordinatorConfig = {
    bootstrap: true,
    address: config.zkopruContract,
    maxBytes: 131072,
    maxBid: 20000,
    vhosts: '*',
    priceMultiplier: 48,
    publicUrls: `${coordinatorIp}:8888`, // Coordinator Network address will be register on Contract.
    port: 8888,
  }

  const coordinator = new Coordinator(
    fullNode,
    coordinatorAccount.ethAccount,
    coordinatorConfig,
  )

  await coordinator.start()

  // TODO: Set context like integrated test
}

async function main() {
  await testCoodinator()
}

main()
