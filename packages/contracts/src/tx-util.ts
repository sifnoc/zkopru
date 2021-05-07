/* eslint-disable @typescript-eslint/no-explicit-any */
import Web3 from 'web3'
import { Account, TransactionReceipt } from 'web3-core'
import {
  PayableTransactionObject,
  NonPayableTransactionObject,
  PayableTx,
  NonPayableTx,
} from './contracts/types'

export type TransactionObject<T> =
  | PayableTransactionObject<T>
  | NonPayableTransactionObject<T>
export type Tx = PayableTx | NonPayableTx

export class TxUtil {
  static async getSignedTransaction<T>(
    tx: TransactionObject<T>,
    address: string,
    web3: Web3,
    account: Account,
    option?: Tx,
  ): Promise<string> {
    const [gas, gasPrice] = await Promise.all([
      tx.estimateGas({
        ...option,
        from: account.address,
      }),
      web3.eth.getGasPrice(),
    ])
    const value = option ? (option as PayableTx).value : undefined

    let forcedSetGas
    if (option?.gas) {
      forcedSetGas = option.gas
    }
    let forcedSetGasPrice
    if (option?.gasPrice) {
      forcedSetGasPrice = option.gasPrice
    }
    const { rawTransaction } = await web3.eth.accounts.signTransaction(
      {
        gasPrice: forcedSetGasPrice ?? gasPrice,
        gas: forcedSetGas ?? gas,
        to: address,
        value,
        data: tx.encodeABI(),
      },
      account.privateKey,
    )
    return rawTransaction as string
  }

  static async sendTx<T>(
    tx: TransactionObject<T>,
    address: string,
    web3: Web3,
    account: Account,
    option?: Tx,
  ): Promise<TransactionReceipt | undefined> {
    const signedTx = await this.getSignedTransaction(
      tx,
      address,
      web3,
      account,
      option,
    )
    return web3.eth.sendSignedTransaction(signedTx)
  }
}
