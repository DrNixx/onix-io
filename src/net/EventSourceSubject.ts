import { NextObserver, Subject, Observable, Observer, ReplaySubject, Operator, Subscription, Subscriber } from 'rxjs';
import { AnonymousSubject } from 'rxjs/internal/Subject';
import { tryCatch } from 'rxjs/internal/util/tryCatch';
import { errorObject } from 'rxjs/internal/util/errorObject';
import { root } from 'rxjs/internal/util/root';

export interface EventSourceSubjectConfig {
  url: string;
  resultSelector?: <T>(e: MessageEvent) => T;
  openObserver?: NextObserver<Event>;
  closeObserver?: NextObserver<void>;
  EventSourceCtor?: { new(url: string): any };
}

export class EventSourceSubject<T> extends AnonymousSubject<T> {
  public url: string;
  public eventSource: any;
  public openObserver: NextObserver<Event>;
  public closeObserver: NextObserver<void>;
  public EventSourceCtor: { new(url: string): any };

  private _output: Subject<T>;

  resultSelector(e: MessageEvent) {
    return JSON.parse(e.data);
  }

  /**
   * @param urlConfigOrSource
   * @return {EventSourceSubject}
   * @static true
   * @name eventSource
   * @owner Observable
   */
  static create<T>(urlConfigOrSource: string | EventSourceSubjectConfig): EventSourceSubject<T> {
    return new EventSourceSubject<T>(urlConfigOrSource);
  }

  constructor(urlConfigOrSource: string | EventSourceSubjectConfig | Observable<T>, destination?: Observer<T>) {
    if (urlConfigOrSource instanceof Observable) {
      super(destination, <Observable<T>> urlConfigOrSource);
    } else {
      super();
      this.EventSourceCtor = root.EventSource;
      this._output = new Subject<T>();
      if (typeof urlConfigOrSource === 'string') {
        this.url = urlConfigOrSource;
      } else {
        // WARNING: config object could override important members here.
        for (var key in urlConfigOrSource) {
          if (urlConfigOrSource.hasOwnProperty(key)) {
              this[key] = urlConfigOrSource[key];
          }
        }
      }
      if (!this.EventSourceCtor) {
        throw new Error('no EventSource constructor can be found');
      }
      this.destination = new ReplaySubject();
    }
  }

  lift<R>(operator: Operator<T, R>): EventSourceSubject<R> {
    const sock = new EventSourceSubject<R>(this, <any> this.destination);
    sock.operator = operator;
    return sock;
  }

  // TODO: factor this out to be a proper Operator/Subscriber implementation and eliminate closures
  multiplex(subMsg: () => any, unsubMsg: () => any, messageFilter: (value: T) => boolean) {
    const self = this;
    return new Observable((observer: Observer<any>) => {
      const result = tryCatch(subMsg)();
      if (result === errorObject) {
        observer.error(errorObject.e);
      } else {
        self.next(result);
      }

      let subscription = self.subscribe(x => {
        const result = tryCatch(messageFilter)(x);
        if (result === errorObject) {
          observer.error(errorObject.e);
        } else if (result) {
          observer.next(x);
        }
      },
        err => observer.error(err),
        () => observer.complete());

      return () => {
        const result = tryCatch(unsubMsg)();
        if (result === errorObject) {
          observer.error(errorObject.e);
        } else {
          self.next(result);
        }
        subscription.unsubscribe();
      };
    });
  }

  private _connectEventSource() {
    const { EventSourceCtor } = this;
    const observer = this._output;

    let eventSource: any = null;
    try {
      eventSource = new EventSourceCtor(this.url);
      this.eventSource = eventSource;
    } catch (e) {
      observer.error(e);
      return;
    }

    const subscription = new Subscription(() => {
      this.eventSource = null;
      if (eventSource && eventSource.readyState === 1) {
        eventSource.close();
      }
    });

    eventSource.onopen = (e: Event) => {
      const openObserver = this.openObserver;
      if (openObserver) {
        openObserver.next(e);
      }

      const queue = this.destination;

      this.destination = Subscriber.create(
        (x) => false,
        (e) => {
          const closingObserver = this.closeObserver;
          if (closingObserver) {
            closingObserver.next(undefined);
          }
          if (e && e.code) {
            eventSource.close();
          } else {
            observer.error(new TypeError('EventSourceSubject.error must be called with an object with an error code, ' +
              'and an optional reason: { code: number, reason: string }'));
          }
          this.destination = new ReplaySubject();
          this.eventSource = null;
        },
        ( ) => {
          const closingObserver = this.closeObserver;
          if (closingObserver) {
            closingObserver.next(undefined);
          }
          eventSource.close();
          this.destination = new ReplaySubject();
          this.eventSource = null;
        }
      );

      if (queue && queue instanceof ReplaySubject) {
        subscription.add((<ReplaySubject<T>>queue).subscribe(this.destination));
      }
    };

    eventSource.onerror = (e: Event) => observer.error(e);

    eventSource.onmessage = (e: MessageEvent) => {
      const result = tryCatch(this.resultSelector)(e);
      if (result === errorObject) {
        observer.error(errorObject.e);
      } else {
        observer.next(result);
      }
    };
  }

  public _subscribe(subscriber: Subscriber<T>): Subscription {
    const { source } = this;
    if (source) {
      return source.subscribe(subscriber);
    }
    if (!this.eventSource) {
      this._connectEventSource();
    }
    let subscription = new Subscription();
    subscription.add(this._output.subscribe(subscriber));
    subscription.add(() => {
      const { eventSource } = this;
      if (this._output.observers.length === 0 && eventSource && eventSource.readyState === 1) {
        eventSource.close();
        this.eventSource = null;
      }
    });
    return subscription;
  }

  unsubscribe() {
    const { source, eventSource } = this;
    if (eventSource && eventSource.readyState === 1) {
      eventSource.close();
      this.eventSource = null;
    }
    super.unsubscribe();
    if (!source) {
      this.destination = new ReplaySubject();
    }
  }

  complete() {
    const { eventSource } = this;
    if (eventSource) {
      try {
        eventSource.close();
      } catch (ex) { }
      
      this.eventSource = null;
    }  
    super.complete();
  }
}
