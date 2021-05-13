import {GossipType} from "../interface";
import {validateAggregatedAttestation} from "./aggregatedAttestation";
import {validateCommitteeAttestation} from "./attestation";
import {validateAttesterSlashing} from "./attesterSlashing";
import {validateBeaconBlock} from "./block";
import {validateProposerSlashing} from "./proposerSlashing";
import {validateSyncCommitteeContribution} from "./syncCommitteeContribution";
import {validateSyncCommittee} from "./syncCommittee";
import {validateVoluntaryExit} from "./voluntaryExit";

export const validatorFns = {
  [GossipType.beacon_block]: validateBeaconBlock,
  [GossipType.beacon_aggregate_and_proof]: validateAggregatedAttestation,
  [GossipType.beacon_attestation]: validateCommitteeAttestation,
  [GossipType.voluntary_exit]: validateVoluntaryExit,
  [GossipType.proposer_slashing]: validateProposerSlashing,
  [GossipType.attester_slashing]: validateAttesterSlashing,
  [GossipType.sync_committee_contribution_and_proof]: validateSyncCommitteeContribution,
  [GossipType.sync_committee]: validateSyncCommittee,
};