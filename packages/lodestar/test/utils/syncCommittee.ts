import {altair} from "@chainsafe/lodestar-types";
import {isPlainObject, RecursivePartial} from "@chainsafe/lodestar-utils";
import deepmerge from "deepmerge";

export function generateSyncCommitteeSignature(
  override: RecursivePartial<altair.SyncCommitteeSignature>
): altair.SyncCommitteeSignature {
  return deepmerge<altair.SyncCommitteeSignature, RecursivePartial<altair.SyncCommitteeSignature>>(
    {
      slot: 0,
      beaconBlockRoot: Buffer.alloc(32),
      validatorIndex: 0,
      signature: Buffer.alloc(96),
    },
    override,
    {isMergeableObject: isPlainObject}
  );
}
