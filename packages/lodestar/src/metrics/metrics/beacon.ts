import {RegistryMetricCreator} from "../utils/registryMetricCreator";

export type IBeaconMetrics = ReturnType<typeof createBeaconMetrics>;

/**
 * Metrics from:
 * https://github.com/ethereum/eth2.0-metrics/ and
 * https://hackmd.io/D5FmoeFZScim_squBFl8oA
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createBeaconMetrics(register: RegistryMetricCreator) {
  return {
    peers: register.gauge({
      name: "libp2p_peers",
      help: "number of connected peers",
    }),
    slot: register.gauge({
      name: "beacon_slot",
      help: "latest slot",
    }),
    headSlot: register.gauge({
      name: "beacon_head_slot",
      help: "slot of the head block of the beacon chain",
    }),
    headRoot: register.gauge({
      name: "beacon_head_root",
      help: "root of the head block of the beacon chain",
    }),
    finalizedEpoch: register.gauge({
      name: "beacon_finalized_epoch",
      help: "current finalized epoch",
    }),
    finalizedRoot: register.gauge({
      name: "beacon_finalized_root",
      help: "current finalized root",
    }),
    currentJustifiedEpoch: register.gauge({
      name: "beacon_current_justified_epoch",
      help: "current justified epoch",
    }),
    currentJustifiedRoot: register.gauge({
      name: "beacon_current_justified_root",
      help: "current justified root",
    }),
    previousJustifiedEpoch: register.gauge({
      name: "beacon_previous_justified_epoch",
      help: "previous justified epoch",
    }),
    previousJustifiedRoot: register.gauge({
      name: "beacon_previous_justified_root",
      help: "previous justified root",
    }),
    currentValidators: register.gauge<"status">({
      name: "beacon_current_validators",
      labelNames: ["status"],
      help: "number of validators in current epoch",
    }),
    previousValidators: register.gauge<"status">({
      name: "beacon_previous_validators",
      labelNames: ["status"],
      help: "number of validators in previous epoch",
    }),
    currentLiveValidators: register.gauge({
      name: "beacon_current_live_validators",
      help: "number of active validators that successfully included attestation on chain for current epoch",
    }),
    previousLiveValidators: register.gauge({
      name: "beacon_previous_live_validators",
      help: "number of active validators that successfully included attestation on chain for previous epoch",
    }),
    pendingDeposits: register.gauge({
      name: "beacon_pending_deposits",
      help: "number of pending deposits",
    }),
    processedDepositsTotal: register.gauge({
      name: "beacon_processed_deposits_total",
      help: "number of total deposits included on chain",
    }),
    pendingExits: register.gauge({
      name: "beacon_pending_exits",
      help: "number of pending voluntary exits",
    }),
    previousEpochOrphanedBlocks: register.gauge({
      name: "beacon_previous_epoch_orphaned_blocks",
      help: "number of blocks not included into the chain in previous epoch",
    }),
    reorgEventsTotal: register.gauge({
      name: "beacon_reorg_events_total",
      help: "number of chain reorganizations",
    }),
    currentEpochActiveGwei: register.gauge({
      name: "beacon_current_epoch_active_gwei",
      help: "current epoch active balances",
    }),
    currentEpochSourceGwei: register.gauge({
      name: "beacon_current_epoch_source_gwei",
      help: "current epoch source balances",
    }),
    currentEpochTargetGwei: register.gauge({
      name: "beacon_current_epoch_target_gwei",
      help: "current epoch target balances",
    }),
    previousEpochActiveGwei: register.gauge({
      name: "beacon_previous_epoch_active_gwei",
      help: "previous epoch active balances",
    }),
    previousEpochSourceGwei: register.gauge({
      name: "beacon_previous_epoch_source_gwei",
      help: "previous epoch source balances",
    }),
    previousEpochTargetGwei: register.gauge({
      name: "beacon_previous_epoch_target_gwei",
      help: "previous epoch target balances",
    }),
    observedEpochAttesters: register.gauge({
      name: "beacon_observed_epoch_attesters",
      help: "number of attesters for which we have seen an attestation, not necessarily included on chain.",
    }),
    observedEpochAggregators: register.gauge({
      name: "beacon_observed_epoch_aggregators",
      help: "number of aggregators for which we have seen an attestation, not necessarily included on chain.",
    }),
  };
}
