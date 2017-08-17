import mean = require('lodash/mean');
import { IEventArgs, EventHandler } from 'onix-core';
import { IStream } from "onix-app";
import { stdDeviation } from 'onix-core';
import { Logger } from 'onix-core';

var REQUEST_PING_EVERY = 5;
var PING_DATA_POINTS = 100;

export class LatencyResolver {
    private tryCount: number;
    private pingData: number[];
    private latency: number;
    private requestedAt: Date;
    private label: string;


    constructor(adapter: IStream) {
        this.tryCount = 0;
        this.requestedAt = null;
        this.pingData = [];
        this.latency = 0;
        this.label = "...";
        //adapter.OnPingRequest.Bind(new EventHandler(this.pingRequest, this));
    }

    private pingRequest(args: IEventArgs) {
        if (this.requestedAt) {
            this.addData(new Date().getTime() - this.requestedAt.getTime());
            this.requestedAt = null;
        }
    }

    private updateLatency(): void {
        var validItemCount = 0,
            totalValue = 0,
            standardDeviation = stdDeviation(this.pingData),
            baseAverage = mean(this.pingData);

        for (var i = 0; i < this.pingData.length; i++) {
            if (Math.abs(this.pingData[i] - baseAverage) <= standardDeviation) {
                validItemCount++;
                totalValue += this.pingData[i];
            }
        }

        if (validItemCount > 0) {
            this.latency = Math.round(totalValue / validItemCount);
            this.label = this.latency.toString() + "ms";
            Logger.debug("latency: " + this.label);
        }
    }

    public addData(timeElapsed: number): void {
        if (this.pingData.length === PING_DATA_POINTS) {
            this.pingData.shift();
        }

        this.pingData.push(timeElapsed);
        this.updateLatency();
    }

    public tryRequestPing(): boolean {
        if (++this.tryCount % REQUEST_PING_EVERY === 0) {
            this.requestedAt = new Date();
            return true;
        }

        return false;
    }
}