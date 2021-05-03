import {RegistryMetricCreator} from "../utils/registryMetricCreator";
import {IMetricsOptions} from "../options";

export type ILodestarMetrics = ReturnType<typeof createLodestarMetrics>;

/**
 * Extra Lodestar custom metrics
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function createLodestarMetrics(register: RegistryMetricCreator, metadata: IMetricsOptions["metadata"]) {
  if (metadata) {
    register.static<"semver" | "branch" | "commit" | "version" | "network">({
      name: "lodestar_version",
      help: "Lodestar version",
      value: metadata,
    });
  }

  return {
    peersByDirection: register.gauge<"direction">({
      name: "lodestar_peers_by_direction",
      help: "number of peers, labeled by direction",
      labelNames: ["direction"],
    }),
    peerConnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_connected",
      help: "Number of peer:connected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerDisconnectedEvent: register.gauge<"direction">({
      name: "lodestar_peer_disconnected",
      help: "Number of peer:disconnected event, labeled by direction",
      labelNames: ["direction"],
    }),
    peerGoodbyeReceived: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_received",
      help: "Number of goodbye received, labeled by reason",
      labelNames: ["reason"],
    }),
    peerGoodbyeSent: register.gauge<"reason">({
      name: "lodestar_peer_goodbye_sent",
      help: "Number of goodbye sent, labeled by reason",
      labelNames: ["reason"],
    }),
    peersTotalUniqueConnected: register.gauge({
      name: "lodestar_peers_total_unique_connected",
      help: "Total number of unique peers that have had a connection with",
    }),

    gossipMeshPeersByType: register.gauge<"gossipType">({
      name: "lodestar_gossip_mesh_peers_by_type",
      help: "Number of connected mesh peers per gossip type",
      labelNames: ["gossipType"],
    }),
    gossipMeshPeersByBeaconAttestationSubnet: register.gauge<"subnet">({
      name: "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet",
      help: "Number of connected mesh peers per beacon attestation subnet",
      labelNames: ["subnet"],
    }),

    gossipValidationQueueLength: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_length",
      help: "Count of total gossip validation queue length",
      labelNames: ["topic"],
    }),
    gossipValidationQueueDroppedJobs: register.gauge<"topic">({
      name: "lodestar_gossip_validation_queue_dropped_jobs_total",
      help: "Count of total gossip validation queue dropped jobs",
      labelNames: ["topic"],
    }),
    gossipValidationQueueJobTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_time_seconds",
      help: "Time to process gossip validation queue job in seconds",
      labelNames: ["topic"],
    }),
    gossipValidationQueueJobWaitTime: register.histogram<"topic">({
      name: "lodestar_gossip_validation_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      labelNames: ["topic"],
      buckets: [0.1, 1, 10, 100],
    }),

    blockProcessorQueueLength: register.gauge({
      name: "lodestar_block_processor_queue_length",
      help: "Count of total block processor queue length",
    }),
    blockProcessorQueueDroppedJobs: register.gauge({
      name: "lodestar_block_processor_queue_dropped_jobs_total",
      help: "Count of total block processor queue dropped jobs",
    }),
    blockProcessorQueueJobTime: register.histogram({
      name: "lodestar_block_processor_queue_job_time_seconds",
      help: "Time to process block processor queue job in seconds",
    }),
    blockProcessorQueueJobWaitTime: register.histogram({
      name: "lodestar_block_processor_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      buckets: [0.1, 1, 10, 100],
    }),

    apiRestResponseTime: register.histogram<"operationId">({
      name: "lodestar_api_rest_response_time_seconds",
      help: "Time to fullfill a request to the REST api labeled by operationId",
      labelNames: ["operationId"],
      // Request times range between 1ms to 100ms in normal conditions. Can get to 1-5 seconds if overloaded
      buckets: [0.01, 0.1, 0.5, 1, 5, 10],
    }),

    // BLS verifier thread pool and queue

    blsThreadPoolSuccessJobsSignatureSetsCount: register.gauge({
      name: "lodestar_bls_thread_pool_success_jobs_signature_sets_count",
      help: "Count of total verified signature sets",
    }),
    blsThreadPoolSuccessJobsWorkerTime: register.gauge({
      name: "lodestar_bls_thread_pool_success_time_seconds_sum",
      help: "Total time spent verifying signature sets measured on the worker",
    }),
    blsThreadPoolJobWaitTime: register.histogram({
      name: "lodestar_bls_thread_pool_queue_job_wait_time_seconds",
      help: "Time from job added to the queue to starting the job in seconds",
      buckets: [0.1, 1, 10],
    }),
    blsThreadPoolTotalJobsStarted: register.gauge({
      name: "lodestar_bls_thread_pool_jobs_started_total",
      help: "Count of total jobs started in bls thread pool, jobs include +1 signature sets",
    }),
    blsThreadPoolTotalJobsGroupsStarted: register.gauge({
      name: "lodestar_bls_thread_pool_job_groups_started_total",
      help: "Count of total jobs groups started in bls thread pool, job groups include +1 jobs",
    }),

    // Validator monitoring

    validatorMonitor: {
      validatorMonitorValidatorsTotal: register.gauge({
        name: "validator_monitor_validators_total",
        help: "Count of validators that are specifically monitored by this beacon node",
        labelNames: ["index"],
      }),

      // Validator Monitor Metrics (per-epoch summaries)

      prevEpochOnChainAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_attester_hit",
        help: "Incremented if the validator is flagged as a previous epoch attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_attester_miss",
        help: "Incremented if the validator is not flagged as a previous epoch attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainHeadAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_hit",
        help: "Incremented if the validator is flagged as a previous epoch head attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainHeadAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_head_attester_miss",
        help:
          "Incremented if the validator is not flagged as a previous epoch head attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainTargetAttesterHit: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_hit",
        help: "Incremented if the validator is flagged as a previous epoch target attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainTargetAttesterMiss: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_target_attester_miss",
        help:
          "Incremented if the validator is not flagged as a previous epoch target attester during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochOnChainInclusionDistance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_on_chain_inclusion_distance",
        help: "The attestation inclusion distance calculated during per epoch processing",
        labelNames: ["index"],
      }),
      prevEpochAttestationsTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestations_total",
        help: "The number of unagg. attestations seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochAttestationsMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_attestations_min_delay_seconds",
        help: "The min delay between when the validator should send the attestation and when it was received",
        labelNames: ["index"],
      }),
      prevEpochAttestationAggregateInclusions: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_aggregate_inclusions",
        help: "The count of times an attestation was seen inside an aggregate",
        labelNames: ["index"],
      }),
      prevEpochAttestationBlockInclusions: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_block_inclusions",
        help: "The count of times an attestation was seen inside a block",
        labelNames: ["index"],
      }),
      prevEpochAttestationBlockMinInclusionDistance: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_attestation_block_min_inclusion_distance",
        help: "The minimum inclusion distance observed for the inclusion of an attestation in a block",
        labelNames: ["index"],
      }),
      prevEpochBeaconBlocksTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_beacon_blocks_total",
        help: "The number of beacon_blocks seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochBeaconBlocksMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_beacon_blocks_min_delay_seconds",
        help: "The min delay between when the validator should send the block and when it was received",
        labelNames: ["index"],
      }),
      prevEpochAggregatesTotal: register.gauge<"index">({
        name: "validator_monitor_prev_epoch_aggregates_total",
        help: "The number of aggregates seen in the previous epoch",
        labelNames: ["index"],
      }),
      prevEpochAggregatesMinDelaySeconds: register.histogram<"index">({
        name: "validator_monitor_prev_epoch_aggregates_min_delay_seconds",
        help: "The min delay between when the validator should send the aggregate and when it was received",
        labelNames: ["index"],
      }),

      // Validator Monitor Metrics (real-time)

      validatorsTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_validators_total",
        help: "Count of validators that are specifically monitored by this beacon node",
        labelNames: ["index", "src"],
      }),
      unaggregatedAttestationTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_unaggregated_attestation_total",
        help: "Number of unaggregated attestations seen",
        labelNames: ["index", "src"],
      }),
      unaggregatedAttestationDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_unaggregated_attestation_delay_seconds",
        help: "The delay between when the validator should send the attestation and when it was received",
        labelNames: ["index", "src"],
      }),
      aggregatedAttestationTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_aggregated_attestation_total",
        help: "Number of aggregated attestations seen",
        labelNames: ["index", "src"],
      }),
      aggregatedAttestationDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_aggregated_attestation_delay_seconds",
        help: "The delay between then the validator should send the aggregate and when it was received",
        labelNames: ["index", "src"],
      }),
      attestationInAggregateTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_attestation_in_aggregate_total",
        help: "Number of times an attestation has been seen in an aggregate",
        labelNames: ["index", "src"],
      }),
      attestationInAggregateDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_attestation_in_aggregate_delay_seconds",
        help: "The delay between when the validator should send the aggregate and when it was received",
        labelNames: ["index", "src"],
      }),
      attestationInBlockTotal: register.gauge<"index">({
        name: "validator_monitor_attestation_in_block_total",
        help: "Number of times an attestation has been seen in a block",
        labelNames: ["index"],
      }),
      attestationInBlockDelaySlots: register.histogram<"index">({
        name: "validator_monitor_attestation_in_block_delay_slots",
        help: "The excess slots (beyond the minimum delay) between the attestation slot and the block slot",
        labelNames: ["index"],
      }),
      beaconBlockTotal: register.gauge<"index" | "src">({
        name: "validator_monitor_beacon_block_total",
        help: "Number of beacon blocks seen",
        labelNames: ["index", "src"],
      }),
      beaconBlockDelaySeconds: register.histogram<"index" | "src">({
        name: "validator_monitor_beacon_block_delay_seconds",
        help: "The delay between when the validator should send the block and when it was received",
        labelNames: ["index", "src"],
      }),
    },
  };
}
