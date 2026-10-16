import type { MissionEvent } from '@kor-code/mission-control';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'unauthorized' | 'offline';
export type StreamMessage =
  | { kind: 'event'; event: MissionEvent }
  | { kind: 'connection'; connection: Connection; reason: string | null };
export type StreamCommand =
  | { kind: 'subscribe'; headers: Record<string, string> }
  | { kind: 'unsubscribe' | 'reconnect' };
