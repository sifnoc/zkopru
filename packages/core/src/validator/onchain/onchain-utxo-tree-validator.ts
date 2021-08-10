import util from 'util'
import { Uint256 } from 'soltypes'
import { logger } from '@zkopru/utils'
// import { Header } from '../../block'
import {
  BlockData,
  HeaderData,
  OnchainValidation,
  UtxoTreeValidator,
} from '../types'
import {
  blockDataToHexString,
  headerDataToHexString,
  blockDataToBlock,
} from '../utils'
import { OnchainValidatorContext } from './onchain-context'

function logAll(Object) {
  return util.inspect(Object, {
    showHidden: true,
    depth: null,
  })
}

export class OnchainUtxoTreeValidator extends OnchainValidatorContext
  implements UtxoTreeValidator {
  async validateUTXOIndex(
    block: BlockData,
    parentHeader: HeaderData,
    deposits: Uint256[],
  ): Promise<OnchainValidation> {
    const tx = this.layer1.validators.utxoTree.methods.validateUTXOIndex(
      blockDataToHexString(block),
      headerDataToHexString(parentHeader),
      deposits.map(d => d.toString()),
    )
    const result = await this.isSlashable(tx)
    return result
  }

  async validateUTXORoot(
    block: BlockData,
    parentHeader: HeaderData,
    deposits: Uint256[],
    subtreeSiblings: Uint256[],
  ): Promise<OnchainValidation> {
    const tx = this.layer1.validators.utxoTree.methods.validateUTXORoot(
      blockDataToHexString(block),
      headerDataToHexString(parentHeader),
      deposits.map(d => d.toString()),
      subtreeSiblings.map(d => d.toString()),
    )
    const blockdata = blockDataToBlock(block)
    logger.trace(
      `onChainUtxoTree - validateUTXORoot >> proposed block hash : ${blockdata.hash}`,
    )
    logger.trace(
      `onChainUtxoTree - validateUTXORoot >> proposed tx root : ${blockdata.header.txRoot}`,
    )
    logger.trace(
      `onChainUtxoTree - validateUTXORoot >> proposed utxo index : ${blockdata.header.utxoIndex}`,
    )
    logger.trace(
      `onChainUtxoTree - validateUTXORoot >> proposed utxo root : ${blockdata.header.utxoRoot}`,
    )
    const result = await this.isSlashable(tx)
    if (result.slashable) {
      logger.trace(
        `validateUTXORoot input >> blockData data : ${logAll(blockdata.body)}`,
      )
      logger.trace(
        `validateUTXORoot input >> blockData : ${blockDataToHexString(block)}`,
      )
      logger.trace(
        `validateUTXORoot input >> parentHeader : ${headerDataToHexString(
          parentHeader,
        )}`,
      )
      logger.trace(
        `validateUTXORoot input >> blockData ${deposits.map(d =>
          d.toString(),
        )}`,
      )
      logger.trace(
        `validateUTXORoot input >> blockData ${subtreeSiblings.map(d =>
          d.toString(),
        )}`,
      )
      logger.trace(`slahed!! tx string : ${result.tx.encodeABI()}`)
      logger.trace(`send tx to actual run >>`)
      const receipt = await tx.send()
      logger.info(
        `slashed tx call send transaction to Layer 1 \n receipt >> \n\n ${logAll(
          receipt,
        )}`,
      )
    }
    return result
  }
}
