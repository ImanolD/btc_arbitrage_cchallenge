import type { ExchangeId, TopOfBook } from "@arb/shared";

/**
 * In-memory store of the latest top-of-book per exchange. Flat map for O(1)
 * reads in the hot path — the arbitrage engine reads from here on every tick.
 */
export class OrderBookStore {
  private readonly books = new Map<ExchangeId, TopOfBook>();

  update(book: TopOfBook): void {
    this.books.set(book.exchange, book);
  }

  get(exchange: ExchangeId): TopOfBook | undefined {
    return this.books.get(exchange);
  }

  /** All books except the given exchange (used to scan counter-venues). */
  others(exchange: ExchangeId): TopOfBook[] {
    const out: TopOfBook[] = [];
    for (const [id, book] of this.books) {
      if (id !== exchange) out.push(book);
    }
    return out;
  }

  all(): TopOfBook[] {
    return [...this.books.values()];
  }
}
