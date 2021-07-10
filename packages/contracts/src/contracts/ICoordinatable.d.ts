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

export type Finalized = ContractEventLog<{
  blockHash: string
  0: string
}>
export type MassDepositCommit = ContractEventLog<{
  index: string
  merged: string
  fee: string
  0: string
  1: string
  2: string
}>
export type NewErc20 = ContractEventLog<{
  tokenAddr: string
  0: string
}>
export type NewErc721 = ContractEventLog<{
  tokenAddr: string
  0: string
}>
export type NewProposal = ContractEventLog<{
  proposalNum: string
  blockHash: string
  0: string
  1: string
}>
export type StakeChanged = ContractEventLog<{
  coordinator: string
  0: string
}>

export interface ICoordinatable extends BaseContract {
  constructor(
    jsonInterface: any[],
    address?: string,
    options?: ContractOptions,
  ): ICoordinatable
  clone(): ICoordinatable
  methods: {
    register(): PayableTransactionObject<void>

    deregister(): NonPayableTransactionObject<void>

    stake(coordinator: string): PayableTransactionObject<void>

    safePropose(
      blockData: string | number[],
      parentHash: string | number[],
      depositHashes: (string | number[])[],
    ): NonPayableTransactionObject<void>

    propose(blockData: string | number[]): NonPayableTransactionObject<void>

    finalize(finalization: string | number[]): NonPayableTransactionObject<void>

    withdrawReward(
      amount: number | string | BN,
    ): NonPayableTransactionObject<void>

    commitMassDeposit(): NonPayableTransactionObject<void>

    registerERC20(tokenAddr: string): NonPayableTransactionObject<void>

    registerERC721(tokenAddr: string): NonPayableTransactionObject<void>

    isProposable(proposerAddr: string): NonPayableTransactionObject<boolean>
  }
  events: {
    Finalized(cb?: Callback<Finalized>): EventEmitter
    Finalized(options?: EventOptions, cb?: Callback<Finalized>): EventEmitter

    MassDepositCommit(cb?: Callback<MassDepositCommit>): EventEmitter
    MassDepositCommit(
      options?: EventOptions,
      cb?: Callback<MassDepositCommit>,
    ): EventEmitter

    NewErc20(cb?: Callback<NewErc20>): EventEmitter
    NewErc20(options?: EventOptions, cb?: Callback<NewErc20>): EventEmitter

    NewErc721(cb?: Callback<NewErc721>): EventEmitter
    NewErc721(options?: EventOptions, cb?: Callback<NewErc721>): EventEmitter

    NewProposal(cb?: Callback<NewProposal>): EventEmitter
    NewProposal(
      options?: EventOptions,
      cb?: Callback<NewProposal>,
    ): EventEmitter

    StakeChanged(cb?: Callback<StakeChanged>): EventEmitter
    StakeChanged(
      options?: EventOptions,
      cb?: Callback<StakeChanged>,
    ): EventEmitter

    allEvents(options?: EventOptions, cb?: Callback<EventLog>): EventEmitter
  }

  once(event: 'Finalized', cb: Callback<Finalized>): void
  once(event: 'Finalized', options: EventOptions, cb: Callback<Finalized>): void

  once(event: 'MassDepositCommit', cb: Callback<MassDepositCommit>): void
  once(
    event: 'MassDepositCommit',
    options: EventOptions,
    cb: Callback<MassDepositCommit>,
  ): void

  once(event: 'NewErc20', cb: Callback<NewErc20>): void
  once(event: 'NewErc20', options: EventOptions, cb: Callback<NewErc20>): void

  once(event: 'NewErc721', cb: Callback<NewErc721>): void
  once(event: 'NewErc721', options: EventOptions, cb: Callback<NewErc721>): void

  once(event: 'NewProposal', cb: Callback<NewProposal>): void
  once(
    event: 'NewProposal',
    options: EventOptions,
    cb: Callback<NewProposal>,
  ): void

  once(event: 'StakeChanged', cb: Callback<StakeChanged>): void
  once(
    event: 'StakeChanged',
    options: EventOptions,
    cb: Callback<StakeChanged>,
  ): void
}
