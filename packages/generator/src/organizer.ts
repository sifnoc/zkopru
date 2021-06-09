import Web3 from 'web3'
import { logger } from '@zkopru/utils'
import { startLogger } from './generator-utils'
import { config } from './config'
import { OrganizerApi } from './organizer_api'

startLogger('ORGANIZER_LOG')

logger.info('Organizer Initializing')

const webSocketProvider = new Web3.providers.WebsocketProvider(
  config.testnetUrl,
  {
    reconnect: { auto: true },
  },
)

const web3 = new Web3(webSocketProvider)

const organierContext = {
  web3,
  coordinators: {
    '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1':
      process.env.DEFAULT_COORDINATOR ?? 'http://coordinator:8888',
  },
} // Test Coordinator

const organizer = new OrganizerApi(organierContext)
organizer.start()
