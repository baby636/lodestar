/**
 * @module network
 */
import {Connection} from "libp2p";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import {timeoutOptions} from "../../constants";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {IReqResp, IReqRespModules, Libp2pStream} from "./interface";
import {sendRequest} from "./request";
import {handleRequest} from "./response";
import {onOutgoingReqRespError} from "./score";
import {IPeerMetadataStore, IPeerRpcScoreStore} from "../peers";
import {assertSequentialBlocksInRange, formatProtocolId} from "./utils";
import {MetadataController} from "../metadata";
import {INetworkEventBus, NetworkEvent} from "../events";
import {IReqRespHandler} from "./handlers";
import {
  Method,
  Version,
  Encoding,
  Protocol,
  ResponseBody,
  RequestBody,
  RequestTypedContainer,
  protocolsSupported,
} from "./types";

export type IReqRespOptions = Partial<typeof timeoutOptions>;

/**
 * Implementation of eth2 p2p Req/Resp domain.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#the-reqresp-domain
 */
export class ReqResp implements IReqResp {
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private forkDigestContext: IForkDigestContext;
  private reqRespHandler: IReqRespHandler;
  private metadataController: MetadataController;
  private peerMetadata: IPeerMetadataStore;
  private peerRpcScores: IPeerRpcScoreStore;
  private networkEventBus: INetworkEventBus;
  private controller = new AbortController();
  private options?: IReqRespOptions;
  private reqCount = 0;
  private respCount = 0;

  constructor(modules: IReqRespModules, options?: IReqRespOptions) {
    this.config = modules.config;
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.forkDigestContext = modules.forkDigestContext;
    this.reqRespHandler = modules.reqRespHandler;
    this.peerMetadata = modules.peerMetadata;
    this.metadataController = modules.metadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.networkEventBus = modules.networkEventBus;
    this.options = options;
  }

  start(): void {
    this.controller = new AbortController();
    for (const [method, version, encoding] of protocolsSupported) {
      this.libp2p.handle(
        formatProtocolId(method, version, encoding),
        this.getRequestHandler({method, version, encoding})
      );
    }
  }

  stop(): void {
    for (const [method, version, encoding] of protocolsSupported) {
      this.libp2p.unhandle(formatProtocolId(method, version, encoding));
    }
    this.controller.abort();
  }

  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return await this.sendRequest<phase0.Status>(peerId, Method.Status, [Version.V1], request);
  }

  async goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    await this.sendRequest<phase0.Goodbye>(peerId, Method.Goodbye, [Version.V1], request);
  }

  async ping(peerId: PeerId): Promise<phase0.Ping> {
    return await this.sendRequest<phase0.Ping>(peerId, Method.Ping, [Version.V1], this.metadataController.seqNumber);
  }

  async metadata(peerId: PeerId): Promise<phase0.Metadata> {
    return await this.sendRequest<phase0.Metadata>(peerId, Method.Metadata, [Version.V1], null);
  }

  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    const blocks = await this.sendRequest<allForks.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRange,
      [Version.V2, Version.V1], // Prioritize V2
      request,
      request.count
    );
    assertSequentialBlocksInRange(blocks, request);
    return blocks;
  }

  async beaconBlocksByRoot(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRootRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return await this.sendRequest<allForks.SignedBeaconBlock[]>(
      peerId,
      Method.BeaconBlocksByRoot,
      [Version.V2, Version.V1], // Prioritize V2
      request,
      request.length
    );
  }

  // Helper to reduce code duplication
  private async sendRequest<T extends ResponseBody | ResponseBody[]>(
    peerId: PeerId,
    method: Method,
    versions: Version[],
    body: RequestBody,
    maxResponses = 1
  ): Promise<T> {
    try {
      const encoding = this.peerMetadata.encoding.get(peerId) ?? Encoding.SSZ_SNAPPY;
      const result = await sendRequest<T>(
        {config: this.config, logger: this.logger, libp2p: this.libp2p, forkDigestContext: this.forkDigestContext},
        peerId,
        method,
        encoding,
        versions,
        body,
        maxResponses,
        this.controller.signal,
        this.options,
        this.reqCount++
      );

      return result;
    } catch (e) {
      const peerAction = onOutgoingReqRespError(e as Error, method);
      if (peerAction !== null) this.peerRpcScores.applyAction(peerId, peerAction);

      throw e;
    }
  }

  private getRequestHandler({method, version, encoding}: Protocol) {
    return async ({connection, stream}: {connection: Connection; stream: Libp2pStream}) => {
      const peerId = connection.remotePeer;

      // TODO: Do we really need this now that there is only one encoding?
      // Remember the prefered encoding of this peer
      if (method === Method.Status) {
        this.peerMetadata.encoding.set(peerId, encoding);
      }

      try {
        await handleRequest(
          {config: this.config, logger: this.logger, libp2p: this.libp2p, forkDigestContext: this.forkDigestContext},
          this.onRequest.bind(this),
          stream,
          peerId,
          {method, version, encoding},
          this.controller.signal,
          this.respCount++
        );
        // TODO: Do success peer scoring here
      } catch {
        // TODO: Do error peer scoring here
        // Must not throw since this is an event handler
      }
    };
  }

  private async *onRequest(method: Method, requestBody: RequestBody, peerId: PeerId): AsyncIterable<ResponseBody> {
    const requestTyped = {method, body: requestBody} as RequestTypedContainer;

    switch (requestTyped.method) {
      case Method.Ping:
        yield this.metadataController.seqNumber;
        break;
      case Method.Metadata:
        yield this.metadataController.allPhase0;
        break;
      case Method.Goodbye:
        yield BigInt(0);
        break;

      // Don't bubble Ping, Metadata, and, Goodbye requests to the app layer

      case Method.Status:
        yield* this.reqRespHandler.onStatus();
        break;
      case Method.BeaconBlocksByRange:
        yield* this.reqRespHandler.onBeaconBlocksByRange(requestTyped.body);
        break;
      case Method.BeaconBlocksByRoot:
        yield* this.reqRespHandler.onBeaconBlocksByRoot(requestTyped.body);
        break;

      default:
        throw Error(`Unsupported method ${method}`);
    }

    // Allow onRequest to return and close the stream
    // For Goodbye there may be a race condition where the listener of `receivedGoodbye`
    // disconnects in the same syncronous call, preventing the stream from ending cleanly
    setTimeout(() => this.networkEventBus.emit(NetworkEvent.reqRespRequest, requestTyped, peerId), 0);
  }
}
