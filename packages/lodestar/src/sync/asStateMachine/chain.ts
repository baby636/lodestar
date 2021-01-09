import PeerId from "peer-id";
import pushable from "it-pushable";
import {BeaconBlocksByRangeRequest, Epoch, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Batch, BatchStatus} from "./batch";
import {shuffle, sortBy, BlockProcessorError} from "./utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

type BatchId = Epoch;

/**
 * Should return if ALL blocks are processed successfully
 * If SOME blocks are processed must throw BlockProcessorError()
 */
type ProcessChainSegment = (blocks: SignedBeaconBlock[]) => Promise<void>;

type DownloadBeaconBlocksByRange = (peer: PeerId, request: BeaconBlocksByRangeRequest) => Promise<SignedBeaconBlock[]>;

/**
 * Blocks are downloaded in batches from peers. This constant specifies how many epochs worth of
 * blocks per batch are requested _at most_. A batch may request less blocks to account for
 * already requested slots. There is a timeout for each batch request. If this value is too high,
 * we will negatively report peers with poor bandwidth. This can be set arbitrarily high, in which
 * case the responder will fill the response up to the max request size, assuming they have the
 * bandwidth to do so.
 */
const EPOCHS_PER_BATCH = 2;

/**
 * The maximum number of batches to queue before requesting more.
 */
const BATCH_BUFFER_SIZE = 5;

type FinalizedCheckpointPeerSet = {
  peers: PeerId[];
  targetEpoch: Epoch;
};

export class SyncingChain {
  /** The start of the chain segment. Any epoch previous to this one has been validated. */
  startEpoch: Epoch;
  /** Starting epoch of the next batch to be downloaded. */
  downloaderTarget: BatchId;
  /** Starting epoch of the batch to be processed next. Increments as the chain advances.*/
  processorTarget: BatchId;
  /** Batches validated by this chain. */
  validatedBatches = 0;
  /** A multi-threaded, non-blocking processor for applying messages to the beacon chain. */
  private processChainSegment: ProcessChainSegment;
  private downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange;
  /** Puhasble object to guarantee that processChainSegment is run only at once at anytime */
  private batchProcessor = pushable<void>();
  /** Sorted map of batches undergoing some kind of processing. */
  private batches: Map<BatchId, Batch>;
  /** Dynamic targetEpoch with associated peers. May be `null`ed if no suitable peer set exists */
  private peerSet: FinalizedCheckpointPeerSet | null = null;
  private logger: ILogger;
  private config: IBeaconConfig;

  constructor(
    startEpoch: Epoch,
    processChainSegment: ProcessChainSegment,
    downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange,
    config: IBeaconConfig,
    logger: ILogger
  ) {
    this.startEpoch = startEpoch;
    this.batches = new Map();
    this.downloaderTarget = startEpoch;
    this.processorTarget = startEpoch;
    this.processChainSegment = processChainSegment;
    this.downloadBeaconBlocksByRange = downloadBeaconBlocksByRange;
    this.config = config;
    this.logger = logger;
  }

  /**
   * The SyncManager should dynamically inject pools of peers and their targetEpoch through this method.
   * It may inject `null` if the peer pool does not meet some condition like peers < minPeers, which
   * would temporarily pause the sync once all active requests are done.
   */
  peerSetChanged(peerSet: FinalizedCheckpointPeerSet | null): void {
    this.peerSet = peerSet;
    this.triggerBatchDownloader();
  }

  stopSyncing(): void {
    this.batchProcessor.end();
  }

  /**
   * Either a new chain, or an old one with a peer list
   * This chain has been requested to start syncing.
   * This could be new chain, or an old chain that is being resumed.
   */
  async startSyncing(localFinalizedEpoch: Epoch): Promise<void> {
    // to avoid dropping local progress, we advance the chain wrt its batch boundaries. This

    // get the *aligned* epoch that produces a batch containing the `local_finalized_epoch`
    const validatingEpoch =
      this.startEpoch + Math.floor((localFinalizedEpoch - this.startEpoch) / EPOCHS_PER_BATCH) * EPOCHS_PER_BATCH;

    // advance the chain to the new validating epoch
    this.advanceChain(validatingEpoch);

    this.triggerBatchProcessor();
    this.triggerBatchDownloader();

    // start processing batches on demand in strict sequence
    for await (const _ of this.batchProcessor) {
      await this.processCompletedBatches();
    }
  }

  /**
   * Request to process batches if any
   */
  private triggerBatchProcessor(): void {
    this.batchProcessor.push();
  }

  /**
   * Request to download batches if any
   * Backlogs requests into a single pending request
   */
  private triggerBatchDownloader(): void {
    if (this.peerSet) this.requestBatches(this.peerSet);
  }

  //
  // Downloader methods
  //

  /**
   * Attempts to request the next required batches from the peer pool if the chain is syncing. It will exhaust the peer
   * pool and left over batches until the batch buffer is reached or all peers are exhausted.
   *
   * The peers that agree on the `target_head_slot` and `target_head_root` as a canonical chain
   * and thus available to download this chain from, as well as the batches we are currently
   * requesting.
   */
  private requestBatches({peers, targetEpoch}: FinalizedCheckpointPeerSet): void {
    const activeRequestsByPeer = this.getActiveRequestsByPeer();

    // Retry download of existing batches
    for (const batch of this.batches.values()) {
      if (batch.state.status !== BatchStatus.AwaitingDownload) {
        continue;
      }

      // Sort peers by (1) no failed request (2) less active requests, then pick first
      const failedPeers = batch.getFailedPeers();
      const [peer] = sortBy(
        peers,
        (peer) => (failedPeers.includes(peer) ? 1 : 0),
        (peer) => activeRequestsByPeer.get(peer) ?? 0
      );
      if (peer) {
        this.sendBatch(batch, peer);
      }
    }

    // find the next pending batch and request it from the peer
    // randomize the peers for load balancing
    const idlePeers = shuffle(peers.filter((peer) => !activeRequestsByPeer.get(peer)));
    for (const peer of idlePeers) {
      const batch = this.includeNextBatch(targetEpoch);
      if (!batch) {
        break;
      }
      this.sendBatch(batch, peer);
    }
  }

  private getActiveRequestsByPeer(): WeakMap<PeerId, number> {
    const activeRequestsByPeer = new WeakMap<PeerId, number>();
    for (const batch of this.batches.values()) {
      if (batch.state.status === BatchStatus.Downloading) {
        activeRequestsByPeer.set(batch.state.peer, (activeRequestsByPeer.get(batch.state.peer) ?? 0) + 1);
      }
    }
    return activeRequestsByPeer;
  }

  /**
   * Creates the next required batch from the chain. If there are no more batches required,
   * `false` is returned.
   */
  private includeNextBatch(targetEpoch: Epoch): Batch | null {
    // don't request batches beyond the target head slot
    if (this.downloaderTarget > targetEpoch) {
      return null;
    }

    // only request batches up to the buffer size limit
    // NOTE: we don't count batches in the AwaitingValidation state, to prevent stalling sync
    // if the current processing window is contained in a long range of skip slots.
    const batchesInBuffer = Array.from(this.batches.values()).filter(
      (batch) => batch.state.status === BatchStatus.Downloading || batch.state.status === BatchStatus.AwaitingProcessing
    );

    if (batchesInBuffer.length > BATCH_BUFFER_SIZE) {
      return null;
    }

    // This line decides the starting epoch of the next batch
    const batchId = this.downloaderTarget;

    // TODO: Check if a batch for batchId already exists
    const batch = new Batch(this.config, batchId, EPOCHS_PER_BATCH);
    this.batches.set(batchId, batch);

    this.downloaderTarget += EPOCHS_PER_BATCH;

    return batch;
  }

  /**
   * Requests the batch asigned to the given id from a given peer.
   */
  private sendBatch(batch: Batch, peer: PeerId): void {
    // inform the batch about the new request
    batch.startDownloading(peer);

    this.downloadBeaconBlocksByRange(peer, batch.request)
      .then((blocks) => {
        // TODO: verify that blocks are in range
        // TODO: verify that blocks are sequential

        batch.downloadingSuccess(blocks || []);

        // pre-emptively request more blocks from peers whilst we process current blocks,
        this.triggerBatchDownloader();
        this.triggerBatchProcessor();
      })
      .catch((error) => {
        this.logger.debug("beaconBlocksByRange error", error);

        // register the failed download and check if the batch can be retried
        batch.downloadingError();

        this.triggerBatchDownloader();
      });
  }

  //
  // Processor methods
  //

  /**
   * Processes the next ready batch, prioritizing optimistic batches over the processing target.
   */
  private async processCompletedBatches(): Promise<void> {
    // Find the id of the batch we are going to process, check the processing target
    const batch = this.batches.get(this.processorTarget);
    if (!batch) {
      throw Error("RemoveChain.WrongChainState - Batch not found for current processing target");
    }

    switch (batch.state.status) {
      case BatchStatus.AwaitingProcessing:
        return await this.processBatch(this.processorTarget);
      case BatchStatus.Downloading:
        // Batch is not ready, nothing to process
        break;
      case BatchStatus.AwaitingDownload:
      case BatchStatus.Processing:
        // these are all inconsistent states:
        // - AwaitingDownload -> A recoverable failed batch should have been
        //   re-requested.
        // - Processing -> `this.current_processing_batch` is None
        throw Error("RemoveChain::WrongChainState - Robust target batch indicates inconsistent chain state");
      case BatchStatus.AwaitingValidation:
        // we can land here if an empty optimistic batch succeeds processing and is
        // inside the download buffer (between `this.processing_target` and
        // `this.to_be_downloaded`). In this case, eventually the chain advances to the
        // batch (`this.processing_target` reaches this point).
        this.logger.debug("Chain encountered a robust batch awaiting validation");

        this.processorTarget += EPOCHS_PER_BATCH;
        if (this.downloaderTarget <= this.processorTarget) {
          this.downloaderTarget = this.processorTarget + EPOCHS_PER_BATCH;
        }
        this.triggerBatchDownloader();
    }
  }

  /**
   * Sends to process the batch with the given id.
   * The batch must exist and be ready for processing
   */
  private async processBatch(batchId: BatchId): Promise<void> {
    const batch = this.batches.get(this.processorTarget);
    if (!batch) {
      throw Error("RemoveChain.WrongChainState - Batch not found for current processing target");
    }

    try {
      // NOTE: We send empty batches to the processor in order to trigger the block processor
      // result callback. This is done, because an empty batch could end a chain and the logic
      // for removing chains and checking completion is in the callback.

      const blocks = batch.startProcessing();

      await this.processChainSegment(blocks);

      this.onProcessedBatchSuccess(batchId, batch, blocks);
    } catch (error) {
      // onBatchProcessResult - BatchProcessResult.Failed
      this.logger.debug("Batch processing failed");

      // Handle this invalid batch, that is within the re-process retries limit.
      this.onProcessedBatchError(batchId, batch, error);
    }
  }

  private onProcessedBatchSuccess(batchId: BatchId, batch: Batch, blocks: SignedBeaconBlock[]): void {
    // onBatchProcessResult - BatchProcessResult.Success
    batch.processingSuccess();

    // If the processed batch was not empty, we can validate previous unvalidated blocks.
    if (blocks.length > 0) {
      this.advanceChain(batchId);
    }

    // Advance processing target to process next one
    if (batchId === this.processorTarget) {
      this.processorTarget += EPOCHS_PER_BATCH;
    }

    // check if the chain has completed syncing
    if (this.peerSet && this.processorTarget >= this.peerSet.targetEpoch) {
      this.batchProcessor.end();
    } else {
      this.triggerBatchDownloader();
      this.triggerBatchProcessor();
    }
  }

  /**
   * An invalid batch has been received that could not be processed, but that can be retried.
   *
   * These events occur when a peer has successfully responded with blocks, but the blocks we
   * have received are incorrect or invalid. This indicates the peer has not performed as
   * intended and can result in downvoting a peer.
   */
  private onProcessedBatchError(batchId: BatchId, batch: Batch, error: Error): void {
    batch.processingError();

    // chain can continue. Check if it can be moved forward
    if (error instanceof BlockProcessorError && error.importedBlocks.length > 0) {
      // At least one block was successfully verified and imported, so we can be sure all
      // previous batches are valid and we only need to download the current failed batch.
      this.advanceChain(batchId);
    }

    // The current batch could not be processed, indicating either the current or previous
    // batches are invalid.
    // The previous batch could be incomplete due to the block sizes being too large to fit in
    // a single RPC request or there could be consecutive empty batches which are not supposed
    // to be there
    // The current (sub-optimal) strategy is to simply re-request all batches that could
    // potentially be faulty. If a batch returns a different result than the original and
    // results in successful processing, we downvote the original peer that sent us the batch.

    // this is our robust `processing_target`. All previous batches must be awaiting validation
    for (const [id, batch] of this.batches.entries()) {
      if (id >= batchId) {
        continue;
      }

      batch.validationError();
    }

    // no batch maxed out it process attempts, so now the chain's volatile progress must be reset
    this.processorTarget = this.startEpoch;

    this.triggerBatchDownloader();
  }

  /**
   * Removes any batches previous to the given `validating_epoch` and updates the current
   * boundaries of the chain.
   *
   * The `validating_epoch` must align with batch boundaries.
   *
   * If a previous batch has been validated and it had been re-processed, penalize the original
   * peer.
   */
  private advanceChain(validatingEpoch: Epoch): void {
    // make sure this epoch produces an advancement
    if (validatingEpoch <= this.startEpoch) {
      return;
    }

    // safety check for batch boundaries
    if (validatingEpoch % EPOCHS_PER_BATCH != this.startEpoch % EPOCHS_PER_BATCH) {
      throw Error("Validating Epoch is not aligned");
    }

    const removedBatches = new Map<BatchId, Batch>();
    for (const [batchId, batch] of this.batches.entries()) {
      if (batchId < validatingEpoch) {
        removedBatches.set(batchId, batch);
        this.batches.delete(batchId);
      }
    }

    for (const [batchId, batch] of removedBatches.entries()) {
      this.validatedBatches += 1;
      switch (batch.state.status) {
        case BatchStatus.AwaitingValidation:
          // TODO: do peer scoring with download attempts
          break;

        case BatchStatus.Downloading: {
          // remove this batch from the peer's active requests
          // REPLY: Not necessary since the active requests are computed from the batches' state
          break;
        }

        case BatchStatus.AwaitingDownload:
          this.logger.error("batch indicates inconsistent chain state while advancing chain");
          break;

        case BatchStatus.AwaitingProcessing:
          break;
        case BatchStatus.Processing:
          this.logger.debug("Advancing chain while processing a batch", {batchId});
      }
    }

    this.processorTarget = Math.max(this.processorTarget, validatingEpoch);
    const oldStart = this.startEpoch;
    this.startEpoch = validatingEpoch;
    this.downloaderTarget = Math.max(this.downloaderTarget, validatingEpoch);
    if (this.batches.has(this.downloaderTarget)) {
      // if a chain is advanced by Range beyond the previous `this.to_be_downloaded`, we
      // won't have this batch, so we need to request it.
      this.downloaderTarget += EPOCHS_PER_BATCH;
    }

    this.logger.debug("Chain advanced", {oldStart, newStart: this.startEpoch, processorTarget: this.processorTarget});
  }
}