/* eslint dot-notation: ["error", { "allowPattern": "^(_[a-z]+)+$" }] */
import { TransactionObject } from '@zkopru/contracts'
import { logger } from '@zkopru/utils'
import { TransactionConfig } from 'web3-core'
import { L1Contract } from '../../context/layer1'
import { Validation } from '../types'

export class OnchainValidatorContext {
  layer1: L1Contract

  constructor(layer1: L1Contract) {
    this.layer1 = layer1
  }

  async isSlashable(
    tx: TransactionObject<{
      slash: boolean
      reason: string
      0: boolean
      1: string
    }>,
    config?: TransactionConfig,
  ): Promise<Validation> {
    let slashable = false
    try {
      await this.layer1.web3.eth.call({
        ...config,
        to: this.layer1.address,
        data: tx.encodeABI(),
      })
      slashable = true
      await this.layer1.web3.eth.estimateGas(
        {
          to: this.layer1.address,
          data: tx.encodeABI(),
        },
        (_, gas) => {
          logger.warn(
            `core/onchain-context.ts - slashable ${tx['_method']?.name}`,
          )
          logger.warn(
            `core/onchain-context.ts - estimated gas ${tx['_method']?.name}: ${gas}`,
          )
        },
      )
    } catch (err) {
      logger.trace(
        `core/onchain-context.ts - onchain validation: ${tx['_method']?.name}(valid)`,
      )
      slashable = false
    }
    return {
      tx,
      slashable,
    }
  }
}
