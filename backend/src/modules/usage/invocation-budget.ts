type BudgetLimits = {
  readonly budgetUsd: string;
  readonly maxRequests: number;
};

type Reservation = { readonly amount: bigint };

const DECIMAL_SCALE = 10n ** 512n;

export class InvocationBudget {
  private readonly limit: bigint;
  private readonly maxRequests: number;
  private readonly reservations = new Set<Reservation>();
  private reserved = 0n;
  private known = 0n;
  private unknownReportedOverlap = 0n;
  private requests = 0;
  private unknowns = 0;
  private isStopped = false;

  constructor(limits: BudgetLimits) {
    this.limit = parseUsd(limits.budgetUsd);
    this.maxRequests = limits.maxRequests;
    if (
      this.limit <= 0n ||
      !Number.isSafeInteger(this.maxRequests) ||
      this.maxRequests <= 0
    )
      throw new Error('invalid evaluation budget');
  }

  get reservedUsd(): string {
    return formatUsd(this.reserved);
  }

  get knownCostUsd(): string {
    return formatUsd(this.known);
  }

  get requestCount(): number {
    return this.requests;
  }

  get unknownAttemptCount(): number {
    return this.unknowns;
  }

  get stopped(): boolean {
    return this.isStopped;
  }

  stop(): void {
    this.isStopped = true;
  }

  async reserve(amountUsd: string): Promise<Reservation> {
    const amount = parseUsd(amountUsd);
    if (this.isStopped) throw new Error('evaluation budget stopped');
    if (this.requests >= this.maxRequests) {
      this.isStopped = true;
      throw new Error('request limit');
    }
    if (
      this.known + this.reserved - this.unknownReportedOverlap + amount >
      this.limit
    ) {
      this.isStopped = true;
      throw new Error('evaluation budget exceeded');
    }
    this.reserved += amount;
    this.requests += 1;
    const reservation: Reservation = { amount };
    this.reservations.add(reservation);
    return reservation;
  }

  settleUnknown(reservation: Reservation): void {
    this.settle(reservation, null, true);
  }

  settleKnown(reservation: Reservation, actualUsd: string): void {
    this.settle(reservation, actualUsd, false);
  }

  settle(
    reservation: Reservation,
    actualUsd: string | null,
    unknownAttempt: boolean,
  ): boolean {
    if (!this.reservations.has(reservation)) return false;
    this.reservations.delete(reservation);
    let overrun = false;
    if (actualUsd !== null) {
      const actual = parseUsd(actualUsd);
      this.known += actual;
      if (unknownAttempt) {
        this.unknownReportedOverlap +=
          actual < reservation.amount ? actual : reservation.amount;
      } else {
        this.reserved -= reservation.amount;
      }
      overrun = actual > reservation.amount || this.exposure() > this.limit;
      if (overrun) this.isStopped = true;
    }
    if (unknownAttempt) this.unknowns += 1;
    return overrun;
  }

  recordKnownCost(amountUsd: string): void {
    this.known += parseUsd(amountUsd);
    if (this.exposure() > this.limit) this.isStopped = true;
  }

  private exposure(): bigint {
    return this.known + this.reserved - this.unknownReportedOverlap;
  }
}

export function reservationUsd(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion: string,
  outputPricePerMillion: string,
): string {
  const input = BigInt(inputTokens) * parseUsd(inputPricePerMillion);
  const output = BigInt(outputTokens) * parseUsd(outputPricePerMillion);
  const denominator = 1_000_000n;
  const total = input + output;
  const rounded = (total + denominator - 1n) / denominator;
  return formatUsd(rounded);
}

export function parseUsd(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,512}))?$/.exec(value);
  if (!match) throw new Error('invalid USD amount');
  return (
    BigInt(match[1]!) * DECIMAL_SCALE +
    BigInt((match[2] ?? '').padEnd(512, '0'))
  );
}

export function formatUsd(value: bigint): string {
  const whole = value / DECIMAL_SCALE;
  const fraction = (value % DECIMAL_SCALE)
    .toString()
    .padStart(512, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
