import {expect} from "chai";
import axios from "axios";
import {createIBeaconParams, loadConfigYaml} from "../../src/utils";
import * as mainnet from "../../src/presets/mainnet";
import * as minimal from "../../src/presets/minimal";

// Not e2e, but slow. Run with e2e tests

async function downloadRemoteConfig(preset: "mainnet" | "minimal", commit: string): Promise<Record<string, unknown>> {
  const phase0Url = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/phase0.yaml`;
  const altairUrl = `https://raw.githubusercontent.com/ethereum/eth2.0-specs/${commit}/configs/${preset}/altair.yaml`;
  const phase0Res = await axios({url: phase0Url, timeout: 30 * 1000});
  const altairRes = await axios({url: altairUrl, timeout: 30 * 1000});
  return createIBeaconParams({
    ...loadConfigYaml(phase0Res.data),
    ...loadConfigYaml(altairRes.data),
  });
}

describe("Ensure config is synced", function () {
  this.timeout(60 * 1000);

  // TODO: Remove items from this list as the specs are updated
  // Items added here are intentionally either not added, or are different
  // eslint-disable-next-line prettier/prettier
  const blacklist: string[] = [];

  it("mainnet", async function () {
    const remoteParams = await downloadRemoteConfig("mainnet", mainnet.commit);
    const localParams = {...mainnet.params};
    for (const param of blacklist) {
      delete remoteParams[param];
      delete (localParams as Record<string, unknown>)[param];
    }
    expect(localParams).to.deep.equal(remoteParams);
  });

  it("minimal", async function () {
    const remoteParams = await downloadRemoteConfig("minimal", minimal.commit);
    const localParams = {...minimal.params};
    for (const param of blacklist) {
      delete remoteParams[param];
      delete (localParams as Record<string, unknown>)[param];
    }
    expect(localParams).to.deep.equal(remoteParams);
  });
});
