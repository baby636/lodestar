import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Slot, CommitteeIndex, altair, Root} from "@chainsafe/lodestar-types";
import {ILogger, prettyBytes, sleep} from "@chainsafe/lodestar-utils";
import {IApiClient} from "../api";
import {extendError, notAborted, IClock} from "../util";
import {ValidatorStore} from "./validatorStore";
import {SyncCommitteeDutiesService, SyncDutyAndProof} from "./syncCommitteeDuties";
import {groupSyncDutiesBySubCommitteeIndex} from "./utils";
import {IndicesService} from "./indices";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

/**
 * Service that sets up and handles validator sync duties.
 */
export class SyncCommitteeService {
  private readonly dutiesService: SyncCommitteeDutiesService;

  constructor(
    private readonly config: IBeaconConfig,
    private readonly logger: ILogger,
    private readonly apiClient: IApiClient,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    indicesService: IndicesService
  ) {
    this.dutiesService = new SyncCommitteeDutiesService(
      config,
      logger,
      apiClient,
      clock,
      validatorStore,
      indicesService
    );

    // At most every slot, check existing duties from SyncCommitteeDutiesService and run tasks
    clock.runEverySlot(this.runSyncCommitteeTasks);
  }

  private runSyncCommitteeTasks = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    // Before altair fork no need to check duties
    if (computeEpochAtSlot(this.config, slot) < this.config.params.ALTAIR_FORK_EPOCH) {
      return;
    }

    // Fetch info first so a potential delay is absorved by the sleep() below
    const dutiesAtSlot = await this.dutiesService.getDutiesAtSlot(slot);
    const dutiesBySubcommitteeIndex = groupSyncDutiesBySubCommitteeIndex(this.config, dutiesAtSlot);
    if (dutiesAtSlot.length === 0) {
      return;
    }

    // Lighthouse recommends to always wait to 1/3 of the slot, even if the block comes early
    await sleep(this.clock.msToSlotFraction(slot, 1 / 3), signal);

    // Step 1. Download, sign and publish an `SyncCommitteeSignature` for each validator.
    //         Differs from AttestationService, `SyncCommitteeSignature` are equal for all
    const beaconBlockRoot = await this.produceAndPublishSyncCommittees(slot, dutiesAtSlot);

    // Step 2. If an attestation was produced, make an aggregate.
    // First, wait until the `aggregation_production_instant` (2/3rds of the way though the slot)
    await sleep(this.clock.msToSlotFraction(slot, 2 / 3), signal);

    // await for all so if the Beacon node is overloaded it auto-throttles
    // TODO: This approach is convervative to reduce the node's load, review
    await Promise.all(
      Array.from(dutiesBySubcommitteeIndex.entries()).map(async ([subcommitteeIndex, duties]) => {
        if (duties.length === 0) return;
        // Then download, sign and publish a `SignedAggregateAndProof` for each
        // validator that is elected to aggregate for this `slot` and `subcommitteeIndex`.
        await this.produceAndPublishAggregates(slot, subcommitteeIndex, beaconBlockRoot, duties).catch((e) => {
          if (notAborted(e))
            this.logger.error("Error on SyncCommitteeContribution", {slot, index: subcommitteeIndex}, e);
        });
      })
    );
  };

  /**
   * Performs the first step of the attesting process: downloading `SyncCommittee` objects,
   * signing them and returning them to the validator.
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/validator.md#attesting
   *
   * Only one `SyncCommittee` is downloaded from the BN. It is then signed by each
   * validator and the list of individually-signed `SyncCommittee` objects is returned to the BN.
   */
  private async produceAndPublishSyncCommittees(slot: Slot, duties: SyncDutyAndProof[]): Promise<Root> {
    const logCtx = {slot};

    // /eth/v1/beacon/blocks/:blockId/root -> at slot -1

    // Produce one attestation data per slot and subcommitteeIndex
    // Spec: the validator should prepare a SyncCommitteeSignature for the previous slot (slot - 1)
    // as soon as they have determined the head block of slot - 1
    const beaconBlockRoot = await this.apiClient.beacon.blocks.getBlockRoot(slot).catch((e) => {
      throw extendError(e, "Error producing SyncCommitteeSignature");
    });

    const signatures: altair.SyncCommitteeSignature[] = [];

    for (const {duty} of duties) {
      const logCtxValidator = {...logCtx, validator: prettyBytes(duty.pubkey)};
      try {
        signatures.push(
          await this.validatorStore.signSyncCommitteeSignature(duty.pubkey, duty.validatorIndex, slot, beaconBlockRoot)
        );
        this.logger.debug("Signed SyncCommitteeSignature", logCtxValidator);
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error signing SyncCommitteeSignature", logCtxValidator, e);
      }
    }

    if (signatures.length > 0) {
      try {
        await this.apiClient.beacon.pool.submitSyncCommitteeSignatures(signatures);
        this.logger.info("Published SyncCommitteeSignature", {...logCtx, count: signatures.length});
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error publishing SyncCommitteeSignature", logCtx, e);
      }
    }

    return beaconBlockRoot;
  }

  /**
   * Performs the second step of the attesting process: downloading an aggregated `SyncCommittee`,
   * converting it into a `SignedAggregateAndProof` and returning it to the BN.
   *
   * https://github.com/ethereum/eth2.0-specs/blob/v0.12.1/specs/phase0/validator.md#broadcast-aggregate
   *
   * Only one aggregated `SyncCommittee` is downloaded from the BN. It is then signed
   * by each validator and the list of individually-signed `SignedAggregateAndProof` objects is
   * returned to the BN.
   */
  private async produceAndPublishAggregates(
    slot: Slot,
    subcommitteeIndex: CommitteeIndex,
    beaconBlockRoot: Root,
    duties: SyncDutyAndProof[]
  ): Promise<void> {
    const logCtx = {slot, index: subcommitteeIndex};

    // No validator is aggregator, skip
    if (duties.every(({selectionProof}) => selectionProof === null)) {
      return;
    }

    this.logger.verbose("Producing SyncCommitteeContribution", logCtx);
    const contribution = await this.apiClient.validator
      .produceSyncCommitteeContribution(slot, subcommitteeIndex, beaconBlockRoot)
      .catch((e) => {
        throw extendError(e, "Error producing SyncCommitteeContribution");
      });

    const signedContributions: altair.SignedContributionAndProof[] = [];

    for (const {duty, selectionProof} of duties) {
      const logCtxValidator = {...logCtx, validator: prettyBytes(duty.pubkey)};
      try {
        // Produce signed contributions only for validators that are subscribed aggregators.
        if (selectionProof !== null) {
          signedContributions.push(
            await this.validatorStore.signContributionAndProof(duty, selectionProof, contribution)
          );
          this.logger.debug("Signed SyncCommitteeContribution", logCtxValidator);
        }
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error signing SyncCommitteeContribution", logCtxValidator, e);
      }
    }

    if (signedContributions.length > 0) {
      try {
        await this.apiClient.validator.publishContributionAndProofs(signedContributions);
        this.logger.info("Published SyncCommitteeContribution", {...logCtx, count: signedContributions.length});
      } catch (e) {
        if (notAborted(e)) this.logger.error("Error publishing SyncCommitteeContribution", logCtx, e);
      }
    }
  }
}
