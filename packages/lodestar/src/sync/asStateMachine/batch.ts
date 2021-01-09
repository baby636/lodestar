import PeerId from "peer-id";
import {BeaconBlocksByRangeRequest, Epoch, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {hashBlocks} from "./utils";

/**
 * Current state of a batch
 */
export enum BatchStatus {
  /** The batch has failed either downloading or processing, but can be requested again. */
  AwaitingDownload = "AwaitingDownload",
  /** The batch is being downloaded. */
  Downloading = "Downloading",
  /** The batch has been completely downloaded and is ready for processing. */
  AwaitingProcessing = "AwaitingProcessing",
  /** The batch is being processed. */
  Processing = "Processing",
  /**
   * The batch was successfully processed and is waiting to be validated.
   *
   * It is not sufficient to process a batch successfully to consider it correct. This is
   * because batches could be erroneously empty, or incomplete. Therefore, a batch is considered
   * valid, only if the next sequential batch imports at least a block.
   */
  AwaitingValidation = "AwaitingValidation",
}

export type Attempt = {
  /// The peer that made the attempt.
  peer: PeerId;
  /// The hash of the blocks of the attempt.
  hash: Root;
};

export type BatchState =
  | {status: BatchStatus.AwaitingDownload}
  | {status: BatchStatus.Downloading; peer: PeerId; blocks: SignedBeaconBlock[]}
  | {status: BatchStatus.AwaitingProcessing; peer: PeerId; blocks: SignedBeaconBlock[]}
  | {status: BatchStatus.Processing; attempt: Attempt}
  | {status: BatchStatus.AwaitingValidation; attempt: Attempt};

/**
 * Batches are downloaded excluding the first block of the epoch assuming it has already been
 * downloaded.
 *
 * For example:
 *
 * Epoch boundary |                                   |
 *  ... | 30 | 31 | 32 | 33 | 34 | ... | 61 | 62 | 63 | 64 | 65 |
 *       Batch 1       |              Batch 2              |  Batch 3
 */
export class Batch {
  id: Epoch;
  /** State of the batch. */
  state: BatchState = {status: BatchStatus.AwaitingDownload};
  /** BeaconBlocksByRangeRequest */
  request: BeaconBlocksByRangeRequest;
  /** The `Attempts` that have been made and failed to send us this batch. */
  private failedProcessingAttempts: Attempt[] = [];
  /** The number of download retries this batch has undergone due to a failed request. */
  private failedDownloadAttempts: PeerId[] = [];
  private config: IBeaconConfig;

  constructor(config: IBeaconConfig, startEpoch: Epoch, numOfEpochs: number) {
    const startSlot = computeStartSlotAtEpoch(config, startEpoch) + 1;
    const endSlot = startSlot + numOfEpochs * config.params.SLOTS_PER_EPOCH;

    this.id = startEpoch;
    this.request = {
      startSlot: startSlot,
      count: endSlot - startSlot,
      step: 1,
    };

    this.config = config;
  }

  /**
   * Gives a list of peers from which this batch has had a failed download or processing attempt.
   */
  getFailedPeers(): PeerId[] {
    return [...this.failedDownloadAttempts, ...this.failedProcessingAttempts.map((a) => a.peer)];
  }

  /**
   * AwaitingDownload -> Downloading
   */
  startDownloading(peer: PeerId): void {
    if (this.state.status !== BatchStatus.AwaitingDownload) {
      throw new WrongStateError("Starting download for batch in wrong state");
    }
    this.state = {status: BatchStatus.Downloading, peer, blocks: []};
  }

  /**
   * Downloading -> AwaitingProcessing
   */
  downloadingSuccess(blocks: SignedBeaconBlock[]): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new WrongStateError("Download completed for batch in wrong state");
    }

    this.state = {status: BatchStatus.AwaitingProcessing, peer: this.state.peer, blocks};
  }

  /**
   * Downloading -> Failed
   *             -> AwaitingDownload
   */
  downloadingError(): void {
    if (this.state.status !== BatchStatus.Downloading) {
      throw new WrongStateError("Download failed for batch in wrong state");
    }

    // Update batch state and register failed attempt
    this.failedDownloadAttempts.push(this.state.peer);
    this.state = {status: BatchStatus.AwaitingDownload};
  }

  /**
   * AwaitingProcessing -> Processing
   */
  startProcessing(): SignedBeaconBlock[] {
    if (this.state.status !== BatchStatus.AwaitingProcessing) {
      throw new WrongStateError("Starting procesing batch in wrong state");
    }

    const blocks = this.state.blocks;
    this.state = {
      status: BatchStatus.Processing,
      attempt: {peer: this.state.peer, hash: hashBlocks(this.config, this.state.blocks)},
    };
    return blocks;
  }

  /**
   * Processing -> AwaitingValidation
   */
  processingSuccess(): void {
    if (this.state.status !== BatchStatus.Processing) {
      throw new WrongStateError("Procesing completed for batch in wrong state");
    }

    this.state = {status: BatchStatus.AwaitingValidation, attempt: this.state.attempt};
  }

  /**
   * Processing -> AwaitingDownload
   */
  processingError(): void {
    if (this.state.status !== BatchStatus.Processing) {
      throw new WrongStateError("Procesing completed for batch in wrong state");
    }

    this.failedProcessingAttempts.push(this.state.attempt);
    this.state = {status: BatchStatus.AwaitingDownload};
  }

  /**
   * AwaitingValidation -> AwaitingDownload
   */
  validationError(): void {
    if (this.state.status !== BatchStatus.AwaitingValidation) {
      throw new WrongStateError("Procesing completed for batch in wrong state");
    }

    this.failedProcessingAttempts.push(this.state.attempt);
    this.state = {status: BatchStatus.AwaitingDownload};
  }
}

class WrongStateError extends Error {}