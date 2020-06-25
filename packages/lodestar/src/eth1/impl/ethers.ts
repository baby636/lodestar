/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";

import {isValidAddress} from "../../util/address";
import {IBeaconDb} from "../../db";
import {RetryProvider} from "./retryProvider";
import {IEth1Options} from "../options";
import {Eth1EventEmitter, IEth1Notifier, IDepositEvent} from "../interface";
import {groupDepositEventsByBlock} from "./util";

export interface IEthersEth1Options extends IEth1Options {
  contract?: Contract;
}

export interface IEthersEth1Modules {
  config: IBeaconConfig;
  db: IBeaconDb;
  logger: ILogger;
}

const ETH1_BLOCK_RETRY = 3;

/**
 * The EthersEth1Notifier watches the eth1 chain using ethers.js
 *
 * It proceses eth1 blocks, starting from block number `depositContract.deployedAt`, maintaining a follow distance.
 * It stores deposit events and eth1 data in a IBeaconDb resumes processing from the last stored eth1 data
 */
export class EthersEth1Notifier extends (EventEmitter as { new(): Eth1EventEmitter }) implements IEth1Notifier {

  private opts: IEthersEth1Options;

  private provider: ethers.providers.Provider;
  private contract: ethers.Contract;

  private config: IBeaconConfig;
  private db: IBeaconDb;
  private logger: ILogger;

  private started: boolean;
  private lastProcessedEth1BlockNumber: number;

  public constructor(opts: IEthersEth1Options, {config, db, logger}: IEthersEth1Modules) {
    super();
    this.opts = opts;
    this.config = config;
    this.db = db;
    this.logger = logger;
    if(this.opts.providerInstance) {
      this.provider = this.opts.providerInstance;
    } else {
      this.provider = new RetryProvider(
        ETH1_BLOCK_RETRY,
        this.opts.provider.url,
        this.opts.provider.network
      );
    }
    this.contract = opts.contract;
  }

  public async start(): Promise<void> {
    if (!this.opts.enabled) {
      this.logger.verbose("Eth1 notifier is disabled" );
      return;
    }
    if (this.started) {
      this.logger.verbose("Eth1 notifier already started" );
      return;
    }
    this.started = true;
    if(!this.contract) {
      await this.initContract();
    }
    const lastProcessedBlockTag = await this.getLastProcessedBlockTag();
    this.lastProcessedEth1BlockNumber = (await this.getBlock(lastProcessedBlockTag)).number;
    this.logger.info(
      `Started listening to eth1 provider ${this.opts.provider.url} on chain ${this.opts.provider.network}`
    );
    this.logger.verbose(
      `Last processed block number: ${this.lastProcessedEth1BlockNumber}`
    );
    const headBlockNumber = await this.provider.getBlockNumber();
    // process historical unprocessed blocks up to curent head
    // then start listening for incoming blocks
    this.processBlocks(headBlockNumber - this.config.params.ETH1_FOLLOW_DISTANCE).then(() => {
      if(this.started) {
        this.provider.on("block", this.onNewEth1Block.bind(this));
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      this.logger.verbose("Eth1 notifier already stopped");
      return;
    }
    this.provider.removeAllListeners("block");
    this.started = false;
    this.logger.verbose("Eth1 notifier stopped");
  }

  public async getLastProcessedBlockTag(): Promise<string | number> {
    const lastEth1Data = await this.db.eth1Data.lastValue();
    return lastEth1Data ? toHexString(lastEth1Data.blockHash) : this.opts.depositContract.deployedAt;
  }
  public async getLastProcessedDepositIndex(): Promise<number> {
    const lastStoredIndex = await this.db.depositDataRoot.lastKey();
    return lastStoredIndex === null ? -1 : lastStoredIndex;
  }

  public async onNewEth1Block(blockNumber: number): Promise<void> {
    const followBlockNumber = blockNumber - this.config.params.ETH1_FOLLOW_DISTANCE;
    if (followBlockNumber > 0 && followBlockNumber > this.lastProcessedEth1BlockNumber) {
      await this.processBlocks(followBlockNumber);
    }
  }

  /**
   * Process blocks from lastProcessedEth1BlockNumber + 1 until toNumber.
   * @param toNumber
   */
  public async processBlocks(toNumber: number): Promise<void> {
    let rangeBlockNumber = this.lastProcessedEth1BlockNumber;
    while (rangeBlockNumber < toNumber && this.started) {
      const blockNumber = Math.min(this.lastProcessedEth1BlockNumber + 100, toNumber);
      let rangeDepositEvents;
      try {
        rangeDepositEvents = await this.getDepositEvents(this.lastProcessedEth1BlockNumber + 1, blockNumber);
      } catch (ex) {
        this.logger.warn(`eth1: failed to get deposit events from ${this.lastProcessedEth1BlockNumber + 1}`
          + ` to ${blockNumber}`);
        continue;
      }
      let success = true;
      for (const [blockNumber, blockDepositEvents] of groupDepositEventsByBlock(rangeDepositEvents)) {
        if (!await this.processDepositEvents(blockNumber, blockDepositEvents)) {
          success = false;
          break;
        }
      }
      // no error, it's safe to update rangeBlockNumber
      if (success) {
        rangeBlockNumber = blockNumber;
        this.lastProcessedEth1BlockNumber = blockNumber;
      }
    }
  }

  /**
   * Process an eth1 block for DepositEvents and Eth1Data
   *
   * Must process blocks in order with no gaps
   *
   * Returns true if processing was successful
   */
  public async processDepositEvents(blockNumber: number, blockDepositEvents: IDepositEvent[]): Promise<boolean> {
    if (!this.started) {
      this.logger.verbose("Eth1 notifier must be started to process a block");
      return false;
    }
    this.logger.verbose(`Processing deposit events of eth1 block ${blockNumber}`);
    // update state
    await Promise.all([
      // op pool depositData
      this.db.depositData.batchPut(blockDepositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositEvent,
      }))),
      // deposit data roots
      this.db.depositDataRoot.batchPut(blockDepositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: this.config.types.DepositData.hashTreeRoot(depositEvent),
      }))),
    ]);
    const depositCount = blockDepositEvents[blockDepositEvents.length - 1].index + 1;
    if (depositCount >= this.config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT) {
      return await this.processEth1Data(blockNumber, blockDepositEvents);
    }
    return true;
  }

  /**
   * Process proposing data of eth1 block
   * @param blockNumber
   * @param blockDepositEvents
   * @returns true if success
   */
  public async processEth1Data(blockNumber: number, blockDepositEvents: IDepositEvent[]): Promise<boolean> {
    this.logger.verbose(`Processing proposing data of eth1 block ${blockNumber}`);
    const block = await this.getBlock(blockNumber);

    if (!block) {
      this.logger.verbose(`eth1 block ${blockNumber} not found`);
      return false;
    }
    const depositTree = await this.db.depositDataRoot.getTreeBacked(blockDepositEvents[0].index - 1);
    const depositCount = blockDepositEvents[blockDepositEvents.length - 1].index + 1;
    const eth1Data = {
      blockHash: fromHexString(block.hash),
      depositRoot: depositTree.tree().root,
      depositCount,
    };
    // eth1 data
    await this.db.eth1Data.put(block.timestamp, eth1Data);
    this.lastProcessedEth1BlockNumber = blockNumber;
    // emit events
    blockDepositEvents.forEach((depositEvent) => {
      this.emit("deposit", depositEvent.index, depositEvent);
    });
    this.emit("eth1Data", block.timestamp, eth1Data, blockNumber);
    return true;
  }

  public async getDepositEvents(fromBlockTag: string | number, toBLockTag?: string | number): Promise<IDepositEvent[]> {
    const filter = this.contract.filters.DepositEvent();
    const logs = await this.contract.queryFilter(filter, fromBlockTag, toBLockTag || fromBlockTag);
    return logs.map((log) => this.parseDepositEvent(log));
  }

  public async getBlock(blockTag: string | number): Promise<ethers.providers.Block> {
    try {
      // without await we can't catch error
      return await this.provider.getBlock(blockTag);
    } catch (e) {
      this.logger.warn("Failed to get eth1 block " + blockTag + ". Error: " + e.message);
      return null;
    }
  }

  public async initContract(): Promise<void> {
    const address = this.opts.depositContract.address;
    const abi = this.opts.depositContract.abi;
    if (!(await this.contractExists(address))) {
      throw new Error(`There is no deposit contract at given address: ${address}`);
    }
    try {
      this.contract = new ethers.Contract(address, abi, this.provider);
    } catch (e) {
      throw new Error("Eth1 deposit contract not found! Probably wrong eth1 rpc url");
    }
  }

  private async contractExists(address: string): Promise<boolean> {
    if (!isValidAddress(address)) return false;
    const code = await this.provider.getCode(address);
    return !(!code || code === "0x");
  }
  /**
   * Parse DepositEvent log
   */
  private parseDepositEvent(log: ethers.Event): IDepositEvent {
    const values = log.args;
    return {
      blockNumber: log.blockNumber,
      index: this.config.types.Number64.deserialize(fromHexString(values.index)),
      pubkey: fromHexString(values.pubkey),
      withdrawalCredentials: fromHexString(values.withdrawal_credentials),
      amount: this.config.types.Gwei.deserialize(fromHexString(values.amount)),
      signature: fromHexString(values.signature),
    };
  }
}