import { MessageType } from './MessageType';

export interface IStreamMessage {
    type: MessageType;
    channel: string;
    eventid?: string;
    id: number;
    tag?: string;
    time?: string;
    text: any;
    islast?: boolean;
}