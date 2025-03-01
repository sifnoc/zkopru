/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from 'bn.js'
import { ContractOptions } from 'web3-eth-contract'
import { EventLog } from 'web3-core'
import { EventEmitter } from 'events'
import {
  Callback,
  PayableTransactionObject,
  NonPayableTransactionObject,
  BlockType,
  ContractEventLog,
  BaseContract,
} from './types'

interface EventOptions {
  filter?: object
  fromBlock?: BlockType
  topics?: string[]
}

export interface IUtxoTreeValidator extends BaseContract {
  constructor(
    jsonInterface: any[],
    address?: string,
    options?: ContractOptions,
  ): IUtxoTreeValidator
  clone(): IUtxoTreeValidator
  methods: {
    newProof(
      proofId: number | string | BN,
      startingRoot: number | string | BN,
      startingIndex: number | string | BN,
      initialSiblings: (number | string | BN)[],
    ): NonPayableTransactionObject<void>

    updateProof(
      proofId: number | string | BN,
      leaves: (number | string | BN)[],
    ): NonPayableTransactionObject<void>

    validateUTXOIndex(
      blockData: string | number[],
      parentHeader: string | number[],
      deposits: (number | string | BN)[],
    ): NonPayableTransactionObject<{
      slash: boolean
      reason: string
      0: boolean
      1: string
    }>

    validateUTXORoot(
      blockData: string | number[],
      parentHeader: string | number[],
      deposits: (number | string | BN)[],
      initialSiblings: (number | string | BN)[],
    ): NonPayableTransactionObject<{
      slash: boolean
      reason: string
      0: boolean
      1: string
    }>

    validateUTXORootWithProof(
      blockData: string | number[],
      parentHeader: string | number[],
      _deposits: (number | string | BN)[],
      proofId: number | string | BN,
    ): NonPayableTransactionObject<{
      slash: boolean
      reason: string
      0: boolean
      1: string
    }>

    getProof(
      proofId: number | string | BN,
    ): NonPayableTransactionObject<{
      owner: string
      startRoot: string
      startIndex: string
      resultRoot: string
      resultIndex: string
      mergedLeaves: string
      cachedSiblings: string[]
      0: string
      1: string
      2: string
      3: string
      4: string
      5: string
      6: string[]
    }>
  }
  events: {
    allEvents(options?: EventOptions, cb?: Callback<EventLog>): EventEmitter
  }
}
