import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError";
import {validateGossipSyncCommittee} from "../../../../src/chain/validation/syncCommittee";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {generateCachedState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateSyncCommitteeSignature} from "../../../utils/syncCommittee";
import {phase0} from "@chainsafe/lodestar-types";

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.3/specs/altair/p2p-interface.md
describe("Sync Committee Signature validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<IForkChoice>;
  // let computeSubnetsForSyncCommitteeStub: SinonStubFn<typeof syncCommitteeUtils["computeSubnetsForSyncCommittee"]>;
  let db: StubbedBeaconDb;
  let altairForkEpochBk: phase0.Epoch;
  const altairForkEpoch = 2020;

  before(async function () {
    await initBLS();
    altairForkEpochBk = config.params.ALTAIR_FORK_EPOCH;
    config.params.ALTAIR_FORK_EPOCH = altairForkEpoch;
  });

  after(function () {
    config.params.ALTAIR_FORK_EPOCH = altairForkEpochBk;
  });

  beforeEach(function () {
    chain = sandbox.createStubInstance(BeaconChain);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = sandbox.createStubInstance(LocalClock);
    sandbox.stub(chain.clock, "currentSlot").get(() => 2);
    forkChoiceStub = sandbox.createStubInstance(ForkChoice);
    chain.forkChoice = forkChoiceStub;
    db = new StubbedBeaconDb(sandbox, config);
    // computeSubnetsForSyncCommitteeStub = sandbox.stub(syncCommitteeUtils, "computeSubnetsForSyncCommittee");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error - the signature's slot is in the past", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 1});
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - the signature's slot is in the future", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 3});
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - the block being signed over has not been seen", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2});
    forkChoiceStub.hasBlock.returns(false);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT
    );
  });

  it("should throw error - there has been another valid sync committee signature for the declared slot", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2});
    forkChoiceStub.hasBlock.returns(true);
    const headState = generateCachedState({slot: 32 * (altairForkEpoch + 1)}, config, true);
    chain.getHeadState.returns(headState);
    db.syncCommittee.has.returns(true);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN
    );
  });

  it("should throw error - the validator is not part of the current sync committee", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 100});
    forkChoiceStub.hasBlock.returns(true);
    db.syncCommittee.has.returns(false);
    const headState = generateCachedState({slot: 32 * (altairForkEpoch + 1)}, config, true);
    chain.getHeadState.returns(headState);

    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE
    );
  });

  /**
   * Skip this spec check: [REJECT] The subnet_id is correct, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index)
   * because it's the same to VALIDATOR_NOT_IN_SYNC_COMMITTEE
   */
  it.skip("should throw error - incorrect subnet", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 1});
    forkChoiceStub.hasBlock.returns(true);
    db.syncCommittee.has.returns(false);
    const headState = generateCachedState({slot: 32 * (altairForkEpoch + 1)}, config, true);
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX
    );
  });

  it("should throw error - invalid signature", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 1});
    forkChoiceStub.hasBlock.returns(true);
    db.syncCommittee.has.returns(false);
    const headState = generateCachedState({slot: 32 * (altairForkEpoch + 1)}, config, true);

    chain.getHeadState.returns(headState);
    chain.bls = {verifySignatureSets: async () => false};
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, db, {signature: syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });
});
