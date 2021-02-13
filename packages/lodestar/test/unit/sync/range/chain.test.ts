import PeerId from "peer-id";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Epoch, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {linspace} from "../../../../src/util/numpy";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {silentLogger} from "../../../utils/logger";
import {
  SyncChain,
  ProcessChainSegment,
  DownloadBeaconBlocksByRange,
  ChainTarget,
  ReportPeerFn,
} from "../../../../src/sync/range/chain";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType";
import {ZERO_HASH} from "../../../../src/constants";

const debugMode = process.env.DEBUG;

// ORA / BlockRangeFetcher
// - should fetch next range initially
// - should fetch next range based on last fetch block
//     handle the case when peer does not return all blocks
//     next fetch should start from last fetch block
// - should handle getBlockRange error (null, no block or single block)
//     should switch peer
//     second block is ignored since we can't validate if it's orphaned block or not
// - should handle getBlockRange returning 2 blocks, one of which is last fetched block
//     !!! Probably not an issue anymore because the chain won't reject
//     !!! Also chain will ensure that the returned blocks match the requested range
// - should handle getBlockRange timeout
// - should handle non-linear chain segment

describe("sync / range / chain", () => {
  const {SLOTS_PER_EPOCH} = config.params;

  const testCases: {
    id: string;
    startEpoch: Epoch;
    targetEpoch: Epoch;
    badBlocks?: Set<Slot>;
    skippedSlots?: Set<Slot>;
  }[] = [
    {
      id: "Simulate sync with no issues",
      startEpoch: 0,
      targetEpoch: 16,
    },
    {
      id: "Simulate sync with a very long range of skipped slots",
      startEpoch: 0,
      targetEpoch: 16,
      skippedSlots: new Set(linspace(3 * SLOTS_PER_EPOCH, 10 * SLOTS_PER_EPOCH)),
    },
    {
      id: "Simulate sync with multiple ranges of bad blocks",
      startEpoch: 0,
      targetEpoch: 16,
      badBlocks: new Set(linspace(3 * SLOTS_PER_EPOCH, 10 * SLOTS_PER_EPOCH)),
    },
    {
      id: "Simulate sync when right on genesis epoch",
      startEpoch: 0,
      targetEpoch: 0,
    },
    {
      id: "Simulate sync that must be completed immediatelly",
      startEpoch: 20,
      targetEpoch: 16,
    },
  ];

  // Helper variables to trigger errors
  const logger = debugMode ? new WinstonLogger({level: LogLevel.debug}) : silentLogger;
  const ACCEPT_BLOCK = Buffer.alloc(96, 0);
  const REJECT_BLOCK = Buffer.alloc(96, 1);
  const interval: NodeJS.Timeout | null = null;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reportPeer: ReportPeerFn = () => {};

  afterEach(() => {
    if (interval) clearInterval(interval);
  });

  for (const {id, startEpoch, targetEpoch, badBlocks, skippedSlots} of testCases) {
    it(id, async () => {
      const processChainSegment: ProcessChainSegment = async (blocks) => {
        for (const block of blocks) {
          if (block.signature === ACCEPT_BLOCK) continue;
          if (block.signature === REJECT_BLOCK) throw Error("REJECT_BLOCK");
        }
      };

      const downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async (peerId, request) => {
        const blocks: SignedBeaconBlock[] = [];
        for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
          if (skippedSlots?.has(i)) {
            continue; // Skip
          }

          // Only reject once to prevent an infinite loop
          const shouldReject = badBlocks?.has(i);
          if (shouldReject) badBlocks?.delete(i);
          blocks.push({
            message: generateEmptyBlock(),
            signature: shouldReject ? REJECT_BLOCK : ACCEPT_BLOCK,
          });
        }
        return blocks;
      };

      const target: ChainTarget = {slot: computeStartSlotAtEpoch(config, targetEpoch), root: ZERO_HASH};
      const syncType = RangeSyncType.Finalized;
      const initialSync = new SyncChain(
        startEpoch,
        target,
        syncType,
        processChainSegment,
        downloadBeaconBlocksByRange,
        reportPeer,
        config,
        logger
      );

      const peers = [new PeerId(Buffer.from("lodestar"))];
      for (const peer of peers) initialSync.addPeer(peer);

      await initialSync.startSyncing(startEpoch);
    });
  }

  it("Should start with no peers, then sync to target", async () => {
    const startEpoch = 0;
    const targetEpoch = 16;
    const peers = [new PeerId(Buffer.from("lodestar"))];

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const processChainSegment: ProcessChainSegment = async () => {};
    const downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async () => [generateEmptySignedBlock()];

    const target: ChainTarget = {slot: computeStartSlotAtEpoch(config, targetEpoch), root: ZERO_HASH};
    const syncType = RangeSyncType.Finalized;
    const initialSync = new SyncChain(
      startEpoch,
      target,
      syncType,
      processChainSegment,
      downloadBeaconBlocksByRange,
      reportPeer,
      config,
      logger
    );

    // Add peers after some time
    setTimeout(() => {
      for (const peer of peers) initialSync.addPeer(peer);
    }, 20);

    await initialSync.startSyncing(startEpoch);
  });
});