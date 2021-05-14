import {allForks, phase0, Slot} from "@chainsafe/lodestar-types";
import {CachedBeaconState, rotateEpochs} from "../../../fast/util";
import {assert} from "@chainsafe/lodestar-utils";
import {processEpoch} from "../epoch";
import {processSlot} from "./processSlot";
import {IBeaconStateTransitionMetrics} from "../../../metrics";

export {processSlot};

export function processSlots(
  state: CachedBeaconState<phase0.BeaconState>,
  slot: Slot,
  metrics?: IBeaconStateTransitionMetrics | null
): void {
  assert.lte(state.slot, slot, `State slot ${state.slot} must transition to a future slot ${slot}`);
  while (state.slot < slot) {
    processSlot(state);
    // process epoch on the start slot of the next epoch
    if ((state.slot + 1) % state.config.params.SLOTS_PER_EPOCH === 0) {
      const timer = metrics?.stfnEpochTransition.startTimer();
      processEpoch(state);
      state.slot += 1;
      rotateEpochs(state.epochCtx, state as CachedBeaconState<allForks.BeaconState>, state.validators);
      if (timer) timer();
    } else {
      state.slot += 1;
    }
  }
}