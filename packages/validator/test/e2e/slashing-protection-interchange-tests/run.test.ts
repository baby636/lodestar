import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {fromHexString} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
// Test files
import {loadTestCases} from "@chainsafe/slashing-protection-interchange-tests";
// Code to test
import {
  SlashingProtection,
  InterchangeError,
  InvalidAttestationError,
  InvalidBlockError,
} from "../../../src/slashingProtection";
import { downloadTests, loadTestCases as newLoadTestCases } from "./downloadTest";
import { join } from "path";

chai.use(chaiAsPromised);

describe("slashing-protection-interchange-tests", async () => {
  const outputDir = join(__dirname, "./tests");
  await downloadTests(
    {
      // specTestsRepoUrl: SPEC_TEST_REPO_URL,
      specVersion: "v5.0.0",
      outputDir,
    },
    console.log
  ).catch((e) => {
    console.error(e);
    process.exit(1);
  });
  const testCases = newLoadTestCases(`${outputDir}/tests/generated`)
  const testCasesOld = loadTestCases();
  console.log('testCase e.g.: ', testCases.find(a => a.name === "single_validator_multiple_blocks_and_attestations")?.steps[0].interchange)
  console.log('testCasesOld e.g.: ', testCasesOld.find(a => a.name === "single_validator_multiple_blocks_and_attestations")?.interchange)

  const dbLocation = "./.__testdb";
  const controller = new LevelDbController({name: dbLocation}, {logger: new WinstonLogger({level: LogLevel.error})});


  for (const testCase of testCases) {
    describe(testCase.name, async () => {
      for (const step of testCase.steps) {
        const slashingProtection = new SlashingProtection({config, controller});

        beforeEach(async () => {
          await controller.start();
          await controller.clear();
        });
  
        // Import
        beforeEach("Import interchange", async () => {
          expect(await controller.keys()).lengthOf(0, "DB is not empty");
  
          const genesisValidatorsRoot = fromHexString(testCase.genesis_validators_root);
          // console.log('step.interchange: ', step.interchange)
          // step.interchange.metadata.interchange_format = "complete"
          if (step.should_succeed) {
            await slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot);
          } else {
            await expect(
              slashingProtection.importInterchange(step.interchange, genesisValidatorsRoot)
            ).to.not.be.rejectedWith(InterchangeError);
          }
        });
  
        afterEach(async () => {
          await controller.clear();
          await controller.stop();
        });
  
        // Add blocks
        for (const [i, blockRaw] of step.blocks.entries()) {
          it(`Add block ${i}`, async () => {
            const pubkey = fromHexString(blockRaw.pubkey);
            const block: phase0.SlashingProtectionBlock = {
              slot: blockRaw.slot,
              signingRoot: blockRaw.signing_root ? fromHexString(blockRaw.signing_root) : ZERO_HASH,
            };
            if (blockRaw.should_succeed) {
              await slashingProtection.checkAndInsertBlockProposal(pubkey, block);
            } else {
              await expect(slashingProtection.checkAndInsertBlockProposal(pubkey, block)).to.be.rejectedWith(
                InvalidBlockError
              );
            }
          });
        }
  
        // Add attestations
        for (const [i, attestationRaw] of step.attestations.entries()) {
          it.skip(`Add attestation ${i}`, async () => {
            const pubkey = fromHexString(attestationRaw.pubkey);
            const attestation: phase0.SlashingProtectionAttestation = {
              sourceEpoch: attestationRaw.source_epoch,
              targetEpoch: attestationRaw.target_epoch,
              signingRoot: attestationRaw.signing_root ? fromHexString(attestationRaw.signing_root) : ZERO_HASH,
            };
            if (attestationRaw.should_succeed) {
              await slashingProtection.checkAndInsertAttestation(pubkey, attestation);
            } else {
              await expect(slashingProtection.checkAndInsertAttestation(pubkey, attestation)).to.be.rejectedWith(
                InvalidAttestationError
              );
            }
          });
        }
      }
    });
  }
});
