import {Epoch} from "@chainsafe/lodestar-types";
import {Batch, BatchOpts, BatchStatus} from "./batch";

/**
 * Validates that the status and ordering of batches is valid
 * ```
 * [AwaitingValidation]* [Processing]? [AwaitingDownload,Downloading,AwaitingProcessing]*
 * ```
 */
export function validateBatchesStatus(batches: Batch[]): void {
  let processing = 0;
  let preProcessing = 0;
  for (const batch of batches) {
    const status = batch.state.status;
    switch (status) {
      case BatchStatus.AwaitingValidation:
        if (processing > 0) throw Error("AwaitingValidation state found after Processing");
        if (preProcessing > 0) throw Error("AwaitingValidation state found after PreProcessing");
        break;

      case BatchStatus.Processing:
        if (preProcessing > 0) throw Error("Processing state found after PreProcessing");
        if (processing > 0) throw Error("More than one Processing state found");
        processing++;
        break;

      case BatchStatus.AwaitingDownload:
      case BatchStatus.Downloading:
      case BatchStatus.AwaitingProcessing:
        preProcessing++;
        break;

      default:
        throw Error(`Unknown status: ${status}`);
    }
  }
}

/**
 * Return the next batch to process if any.
 * @see validateBatchesStatus for batches state description
 */
export function getNextBatchToProcess(batches: Batch[]): Batch | undefined {
  for (const batch of batches) {
    switch (batch.state.status) {
      // If an AwaitingProcessing batch exists it can only be preceeded by AwaitingValidation
      case BatchStatus.AwaitingValidation:
        break;

      case BatchStatus.AwaitingProcessing:
        return batch;

      // There MUST be no AwaitingProcessing state after AwaitingDownload, Downloading, Processing
      case BatchStatus.AwaitingDownload:
      case BatchStatus.Downloading:
      case BatchStatus.Processing:
        return;
    }
  }
}

/**
 * Compute the startEpoch of the next batch to be processed
 */
export function toBeProcessedStartEpoch(batches: Batch[], startEpoch: Epoch, opts: BatchOpts): Epoch {
  const startEpochs = batches
    .filter((batch) => batch.state.status === BatchStatus.AwaitingValidation)
    .map((batch) => batch.startEpoch);
  return startEpochs.length > 0 ? Math.max(...startEpochs) + opts.epochsPerBatch : startEpoch;
}

/**
 * Compute the startEpoch of the next batch to be downloaded
 */
export function toBeDownloadedStartEpoch(batches: Batch[], startEpoch: Epoch, opts: BatchOpts): Epoch {
  const lastBatch: undefined | Batch = batches[batches.length - 1];
  return lastBatch ? lastBatch.startEpoch + opts.epochsPerBatch : startEpoch;
}

export function toArr<K, V>(map: Map<K, V>): V[] {
  return Array.from(map.values());
}
