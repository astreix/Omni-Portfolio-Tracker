# Security Specification - Omni-Portfolio Tracker

## Data Invariants
1. All records (Transactions, Dividends, Tickers) must belong to the authenticated `userId`.
2. Transactions must have a valid `type` (Buy/Sell).
3. Amounts and quantities must be numeric.
4. Users can only read/write their own data.

## The Dirty Dozen Payloads (to be blocked)
1. Transaction with `userId` of another user.
2. Transaction with negative quantity (should be positive value, `type` handles direction).
3. Dividend with missing `totalGbp`.
4. Updating `userId` of an existing transaction.
5. Large string (1MB+) in `tickerSymbol` to cause resource exhaustion.
6. Malicious path as `tickerSymbol` (e.g. `../...`).
7. Setting `manualPrice` without being authenticated.
8. Deleting another user's transaction.
9. Listing all transactions without a `userId` filter (though Firestore enforces query-based security).
10. Creating a record with a future date (optional but good).
11. Bypassing `isManual` flag for non-manual tickers if we had stricter logic.
12. Injecting extra fields (e.g. `isVerified: true`) into a Transaction document.

## Fortress Rules Plan
- Global deny.
- Helpers for `isSignedIn()`, `isOwner(userId)`, `isValidId()`.
- Entity validation helpers: `isValidTransaction()`, `isValidDividend()`, `isValidTicker()`.
- Action-based updates for Tickers.
