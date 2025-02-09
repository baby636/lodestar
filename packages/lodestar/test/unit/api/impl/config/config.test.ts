import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {ConfigApi} from "../../../../../src/api/impl/config";

describe("config api implementation", function () {
  let api: ConfigApi;

  beforeEach(function () {
    api = new ConfigApi({}, {config});
  });

  describe("getForkSchedule", function () {
    it("should get known scheduled forks", async function () {
      // @TODO: implement the actual fork schedule data get from config params once marin's altair PRs have been merged
      const forkSchedule = await api.getForkSchedule();
      expect(forkSchedule.length).to.equal(0);
    });
  });

  describe("getDepositContract", function () {
    it("should get the deposit contract from config", async function () {
      const depositContract = await api.getDepositContract();
      expect(depositContract.address).to.equal(config.params.DEPOSIT_CONTRACT_ADDRESS);
      expect(depositContract.chainId).to.equal(config.params.DEPOSIT_CHAIN_ID);
    });
  });

  describe("getSpec", function () {
    it("should get the spec", async function () {
      const spec = await api.getSpec();
      expect(spec).to.equal(config.params);
    });
  });
});
