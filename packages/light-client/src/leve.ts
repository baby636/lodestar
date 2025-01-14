import {IBeaconParams} from "@chainsafe/lodestar-params";
import {params} from "@chainsafe/lodestar-params/minimal";

/* eslint-disable @typescript-eslint/naming-convention */

// Leve testnet to demo basic lightclient setup

export const leveParams: IBeaconParams = {
  ...params,

  // Start altair fork immediately
  ALTAIR_FORK_EPOCH: 0,

  // Extra minimal settings
  SYNC_COMMITTEE_SIZE: 4,
  SYNC_PUBKEYS_PER_AGGREGATE: 2,
  // Must be higher than 3 to allow finalized updates
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD: 4,
  SLOTS_PER_EPOCH: 8,
  SECONDS_PER_SLOT: 12,

  MIN_GENESIS_TIME: 1620648600,
  GENESIS_DELAY: 0,
  GENESIS_FORK_VERSION: Buffer.from("0x00004747"),
};

export const leveGenesisTime = 1620648600;
