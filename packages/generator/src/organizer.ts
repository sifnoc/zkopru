import Web3 from 'web3'
import { logger } from '@zkopru/utils'
import { logAll, startLogger } from './baseGenerator'
import { config } from './config'

startLogger('ORGANIZER_LOG')

// Organizer is for
// - collecting data for debugging
// - Control Wallet Containers

export async function main() {
  logger.info('Organizer Initializing')
  const webSocketProvider = new Web3.providers.WebsocketProvider(config.testnetUrl, {
    reconnect: { auto: true },
  })

  const web3 = new Web3(webSocketProvider)

  // Consider Start block
  let currentBlockNumber
  currentBlockNumber = await web3.eth.getBlockNumber()
  logger.info(`Current Block Number ${currentBlockNumber}`)

  web3.eth.subscribe('newBlockHeaders')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .on('data', async function (data) {
      const blockData = await web3.eth.getBlock(data.hash)
      let txs: Promise<any>[] = []
      let receipts: Promise<any>[] = []
      if (blockData.transactions) {
        blockData.transactions.map(txHash => {
          txs.push(web3.eth.getTransaction(txHash))
          receipts.push(web3.eth.getTransactionReceipt(txHash))
        })
      }
      const txData = Promise.all(txs)
      const receiptData = Promise.all(receipts)

      logger.info(`Found txs : ${logAll(txData)}`)
      logger.info(`Found receipts : ${logAll(receiptData)}`)
    })

  function runForever(i: number) {
    setTimeout(() => {
      runForever(++i)
    }, 50000)
  }
  runForever(0)
}

main()