export * from "./signatureSets";
export * from "./stateTransition";
export * from "./util";
export * from "./block";
export * from "./epoch";

// re-export allForks lodestar types for ergonomic usage downstream
// eg:
//
// import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
//
// allForks.processDeposit(...)
//
// const x: allForks.BeaconState;
export * from "@chainsafe/lodestar-types/lib/allForks";
