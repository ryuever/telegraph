/**
 * Serializer protocol interface for checkpoint data serialization.
 */
export interface SerializerProtocol {
  /**
   * Serialize data into a typed [type, bytes] format.
   */
  dumpsTyped(data: unknown): Promise<[string, Uint8Array]>;

  /**
   * Deserialize data from a typed format.
   */
  loadsTyped(type: string, data: Uint8Array | string): Promise<unknown>;
}
