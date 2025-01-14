import {AbortSignal} from "abort-controller";
import {ErrorAborted, ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export interface IClock {
  start(signal: AbortSignal): void;
  runEverySlot(fn: (slot: Slot, signal: AbortSignal) => Promise<void>): void;
  runEveryEpoch(fn: (epoch: Epoch, signal: AbortSignal) => Promise<void>): void;
  msToSlotFraction(slot: Slot, fraction: number): number;
}

export enum TimeItem {
  Slot,
  Epoch,
}

export class Clock implements IClock {
  readonly genesisTime: number;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly fns: {timeItem: TimeItem; fn: RunEveryFn}[] = [];

  constructor(config: IBeaconConfig, logger: ILogger, opts: {genesisTime: number}) {
    this.genesisTime = opts.genesisTime;
    this.config = config;
    this.logger = logger;
  }

  start(signal: AbortSignal): void {
    for (const {timeItem, fn} of this.fns) {
      this.runAtMostEvery(timeItem, signal, fn).catch((e) => {
        this.logger.error("", {}, e);
      });
    }
  }

  runEverySlot(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Slot, fn});
  }

  runEveryEpoch(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Epoch, fn});
  }

  /** Miliseconds from now to a specific slot fraction */
  msToSlotFraction(slot: Slot, fraction: number): number {
    const timeAt = this.genesisTime + this.config.params.SECONDS_PER_SLOT * (slot + fraction);
    return timeAt - Date.now();
  }

  /**
   * If a task happens to take more than one slot to run, we might skip a slot. This is unfortunate,
   * however the alternative is to *always* process every slot, which has the chance of creating a
   * theoretically unlimited backlog of tasks. It was a conscious decision to choose to drop tasks
   * on an overloaded/latent system rather than overload it even more.
   */
  private async runAtMostEvery(timeItem: TimeItem, signal: AbortSignal, fn: RunEveryFn): Promise<void> {
    while (!signal.aborted) {
      // Run immediatelly first
      const slot = getCurrentSlot(this.config, this.genesisTime);

      const slotOrEpoch = timeItem === TimeItem.Slot ? slot : computeEpochAtSlot(this.config, slot);
      await fn(slotOrEpoch, signal);

      try {
        await sleep(this.timeUntilNext(timeItem), signal);
      } catch (e) {
        if (e instanceof ErrorAborted) {
          return;
        }
        throw e;
      }
    }
  }

  private timeUntilNext(timeItem: TimeItem): number {
    const miliSecondsPerSlot = this.config.params.SECONDS_PER_SLOT * 1000;
    const msFromGenesis = Date.now() - this.genesisTime * 1000;

    if (timeItem === TimeItem.Slot) {
      return miliSecondsPerSlot - Math.abs(msFromGenesis % miliSecondsPerSlot);
    } else {
      const miliSecondsPerEpoch = this.config.params.SLOTS_PER_EPOCH * miliSecondsPerSlot;
      return miliSecondsPerEpoch - Math.abs(msFromGenesis % miliSecondsPerEpoch);
    }
  }
}

// function useEventStream() {
//   this.stream = this.events.getEventStream([BeaconEventType.BLOCK, BeaconEventType.HEAD, BeaconEventType.CHAIN_REORG]);
//   pipeToEmitter(this.stream, this).catch((e) => {
//     this.logger.error("Error on stream pipe", {}, e);
//   });

//   // On stop
//   this.stream.stop();
//   this.stream = null;
// }
