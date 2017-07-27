import { Subscription } from 'rxjs';
import { IStreamMessage } from "./IStreamMessage";

export interface IStream {
    subscribe(name: string, message: (value: IStreamMessage) => void, error?: (error: any) => void, complete?: () => void): Subscription;
    removeChannel(channel: string): void;
    removeAll(): void;
}