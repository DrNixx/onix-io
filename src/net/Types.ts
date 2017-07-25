import { Subscription } from 'rxjs';

export interface IError {
    type: string;
}

export enum ConnectionStatus {
    Uninitialized,
    Connecting,
    Online,
    FailedToConnect,
    Offline
}

export enum MessageType {
    None,
    Ping,
    ChannelDeleted,
    Service,
    Activity
}

export interface IServerMessage {
    type: MessageType;
    channel: string;
    eventid?: string;
    id: number;
    tag?: string;
    time?: string;
    text: any;
    islast?: boolean;
}

export interface IServerAdapter {
    subscribe(name: string, message: (value: IServerMessage) => void, error?: (error: any) => void, complete?: () => void): Subscription;
    removeChannel(channel: string): void;
    removeAll(): void;
}