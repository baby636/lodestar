/* eslint-disable @typescript-eslint/naming-convention */

import {ContainerType} from "@chainsafe/ssz";

import {IBeaconParams} from "./interface";
import {Phase0Params} from "./phase0";
import {AltairParams} from "./altair";

export const BeaconParams = new ContainerType<IBeaconParams>({
  fields: {
    ...Phase0Params.fields,
    ...AltairParams.fields,
  },
});
