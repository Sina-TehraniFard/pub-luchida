export type CandleUpdatedEvent = {
  readonly type: 'UPDATED';
};

export type CandleConfirmedEvent = {
  readonly type: 'CONFIRMED';
};

export type CandleEvent = CandleUpdatedEvent | CandleConfirmedEvent;

export const CandleEvent = {
  updated(): CandleUpdatedEvent {
    return { type: 'UPDATED' };
  },
  confirmed(): CandleConfirmedEvent {
    return { type: 'CONFIRMED' };
  },
} as const;
