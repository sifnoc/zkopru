import * as dotenv from 'dotenv'

import { HardhatUserConfig } from 'hardhat/config'
import '@nomiclabs/hardhat-waffle'
import '@typechain/hardhat'

dotenv.config()

const config: HardhatUserConfig = {
  solidity: '0.7.4',
  networks: {
    ropsten: {
      url: process.env.ROPSTEN_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    hardhat: {
      accounts: {
        mnemonic:
          'myth like bonus scare over problem client lizard pioneer submit female collect',
      },
    },
  },
}

export default config
