import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import yahooFinance from "yahoo-finance2";
// In newer versions of yahoo-finance2, a new instance must be created if using as a standalone
const yf = typeof yahooFinance === 'function' ? new (yahooFinance as any)() : yahooFinance;
import { parse } from "csv-parse/sync";

interface Ticker {
  symbol: string;
  name: string;
  asset_class: string;
  is_manual: number;
  manual_price: number | null;
  last_updated: string;
}

interface Account {
  id: number;
  name: string;
}

interface Transaction {
  id: number;
  userId: string;
  portfolioId: string;
  ticker_symbol: string;
  account_id: number;
  type: 'Buy' | 'Sell';
  date: string;
  quantity: number;
  price: number;
  currency: string;
  fx_rate: number;
  fees: number;
  total_gbp: number;
}

interface DividendRecorded {
  id: number;
  ticker: string;
  account_id: number;
  date: string;
  amount_gbp: number;
  wht_gbp: number;
}

interface DividendSchedule {
  id: number;
  ticker: string;
  ex_date: string;
  pay_date: string;
  amount_per_share: number;
  currency: string;
  wht_rate: number;
}

const db = new Database("portfolio.db");

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS tickers (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    asset_class TEXT,
    is_manual INTEGER DEFAULT 0,
    manual_price REAL,
    last_updated DATETIME
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker_symbol TEXT,
    account_id INTEGER,
    type TEXT CHECK(type IN ('Buy', 'Sell')),
    date DATE,
    quantity REAL,
    price REAL,
    currency TEXT,
    fx_rate REAL,
    fees REAL DEFAULT 0,
    total_gbp REAL,
    FOREIGN KEY(ticker_symbol) REFERENCES tickers(symbol),
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS dividends_recorded (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    account_id INTEGER,
    date DATE,
    amount_gbp REAL,
    wht_gbp REAL DEFAULT 0,
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS dividend_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    ex_date DATE,
    pay_date DATE,
    amount_per_share REAL,
    currency TEXT,
    wht_rate REAL DEFAULT 0,
    UNIQUE(ticker, ex_date)
  );
`);

// Migration: Ensure new columns exist in transactions
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN account_id INTEGER").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN fx_rate REAL DEFAULT 1").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN fees REAL DEFAULT 0").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN total_gbp REAL").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE dividends_recorded ADD COLUMN account_id INTEGER").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE dividends_recorded ADD COLUMN wht_gbp REAL DEFAULT 0").run();
} catch (e) {}

async function getHistoricalFX(from: string, to: string, date: string) {
  if (from === to) return 1;
  const symbol = `${from}${to}=X`;
  try {
    const result = await (yf.historical(symbol, {
      period1: date,
      period2: new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0],
    }) as Promise<any[]>);
    return result[0]?.close || 1;
  } catch (e) {
    return 1;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/accounts", (req, res) => {
    const accounts = db.prepare("SELECT * FROM accounts").all();
    res.json(accounts);
  });

  app.post("/api/accounts", (req, res) => {
    const { name } = req.body;
    try {
      const result = db.prepare("INSERT INTO accounts (name) VALUES (?)").run(name);
      res.json({ id: result.lastInsertRowid, name });
    } catch (e) {
      const existing = db.prepare("SELECT * FROM accounts WHERE name = ?").get(name);
      res.json(existing);
    }
  });

  app.get("/api/transactions", (req, res) => {
    const txs = db.prepare("SELECT * FROM transactions").all();
    res.json(txs);
  });

  app.post("/api/transactions", (req, res) => {
    const { ticker_symbol, account_id, type, date, quantity, price, currency, fx_rate, fees, total_gbp } = req.body;
    try {
      db.prepare("INSERT OR IGNORE INTO tickers (symbol, name, asset_class) VALUES (?, ?, ?)").run(ticker_symbol, ticker_symbol, 'Equity');
      db.prepare(`
        INSERT INTO transactions (ticker_symbol, account_id, type, date, quantity, price, currency, fx_rate, fees, total_gbp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ticker_symbol, account_id, type, date, quantity, price, currency, fx_rate, fees, total_gbp);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/dividends-recorded", (req, res) => {
    const divs = db.prepare("SELECT * FROM dividends_recorded").all();
    res.json(divs);
  });

  app.post("/api/dividends-recorded", (req, res) => {
    const { ticker, account_id, date, amount_gbp, wht_gbp } = req.body;
    db.prepare(`
      INSERT INTO dividends_recorded (ticker, account_id, date, amount_gbp, wht_gbp)
      VALUES (?, ?, ?, ?, ?)
    `).run(ticker, account_id, date, amount_gbp, wht_gbp);
    res.json({ success: true });
  });

  app.get("/api/dividend-schedule", (req, res) => {
    const schedules = db.prepare("SELECT * FROM dividend_schedule").all();
    res.json(schedules);
  });

  app.post("/api/dividend-schedule", (req, res) => {
    const { ticker, ex_date, pay_date, amount_per_share, currency, wht_rate } = req.body;
    try {
      db.prepare(`
        INSERT INTO dividend_schedule (ticker, ex_date, pay_date, amount_per_share, currency, wht_rate)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, ex_date) DO UPDATE SET
          pay_date = excluded.pay_date,
          amount_per_share = excluded.amount_per_share,
          currency = excluded.currency,
          wht_rate = excluded.wht_rate
      `).run(ticker, ex_date, pay_date, amount_per_share, currency, wht_rate);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    try {
      const result = await (yf.search(q as string) as Promise<any>);
      res.json(result.quotes || []);
    } catch (e) {
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/batches/transactions", (req, res) => {
    console.log("Batch Import Request received:", req.body?.transactions?.length, "records");
    const { transactions } = req.body;
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const results = { imported: 0, skipped: 0, errors: [] as string[] };
    
    try {
      const tickerStmt = db.prepare("INSERT OR IGNORE INTO tickers (symbol, name, asset_class) VALUES (?, ?, ?)");
      const checkStmt = db.prepare("SELECT id FROM transactions WHERE ticker_symbol = ? AND date = ? AND quantity = ? AND account_id = ?");
      const insertStmt = db.prepare(`
        INSERT INTO transactions (ticker_symbol, account_id, type, date, quantity, price, currency, fx_rate, fees, total_gbp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = db.transaction((txs: any[]) => {
        for (const t of txs) {
          try {
            // Auto-provision ticker
            tickerStmt.run(t.ticker_symbol, t.ticker_symbol, 'Equity');

            // Duplicate check: Same ticker, date, qty, and account
            const exists = checkStmt.get(t.ticker_symbol, t.date, t.quantity, t.account_id);
            if (exists) {
              results.skipped++;
              continue;
            }

            insertStmt.run(
              t.ticker_symbol,
              t.account_id,
              t.type,
              t.date,
              t.quantity,
              t.price,
              t.currency,
              t.fx_rate,
              t.fees || 0,
              t.total_gbp
            );
            results.imported++;
          } catch (e: any) {
            console.error("Row error:", e);
            results.errors.push(`Error on ${t.ticker_symbol} (${t.date}): ${e.message}`);
          }
        }
      });

      transaction(transactions);
      res.json(results);
    } catch (e: any) {
      console.error("Batch Transaction Critical Failure:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/market-data", async (req, res) => {
    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: "Invalid symbols" });
    }

    try {
      const quotes = await Promise.all(
        symbols.map(s => (yf.quote(s) as Promise<any>).catch((err: any) => {
          console.error(`Quote error for ${s}:`, err.message);
          return null;
        }))
      );

      const marketPrices: Record<string, number> = {};
      
      // We'll collect unique non-GBP currencies to fetch FX rates
      const currenciesNeeded = new Set<string>();
      quotes.forEach(q => {
        if (q?.currency && q.currency !== "GBP") {
          currenciesNeeded.add(q.currency);
        }
      });

      // Simple real-time FX fetch for this request
      const fxRates: Record<string, number> = { "GBP": 1 };
      await Promise.all(
        Array.from(currenciesNeeded).map(async (ccy) => {
          if (ccy === "GBp" || ccy === "GBX") {
            fxRates[ccy] = 0.01;
          } else {
            // Fetch current FX rate to GBP
            try {
              const pair = `${ccy}GBP=X`;
              const fxQuote = await yf.quote(pair);
              if (fxQuote?.regularMarketPrice) {
                fxRates[ccy] = fxQuote.regularMarketPrice;
              } else {
                // Try inverse if needed, but CCYGBP=X is standard
                fxRates[ccy] = 0; 
              }
            } catch (e) {
              console.error(`FX fetch error for ${ccy}:`, e);
              fxRates[ccy] = 0;
            }
          }
        })
      );

      quotes.forEach((q, i) => {
        const symbol = symbols[i];
        if (q && q.regularMarketPrice !== undefined) {
          const price = q.regularMarketPrice;
          const currency = q.currency || "GBP";
          const rate = fxRates[currency] ?? (currency === "GBp" || currency === "GBX" ? 0.01 : 1);
          marketPrices[symbol] = price * rate;
        } else {
          marketPrices[symbol] = 0;
        }
      });
      res.json(marketPrices);
    } catch (e: any) {
      console.error("Market data fetch failed", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/accounts/:id", (req, res) => {
    const { id } = req.params;
    try {
      // Check if any transactions rely on this account
      const usage = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE account_id = ?").get(id) as any;
      if (usage.count > 0) {
        return res.status(400).json({ error: "Cannot delete account with existing transactions. Delete or reassign them first." });
      }
      db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/data", async (req, res) => {
    // Legacy support or fallback
    res.json({ transactions: [], dividends: [], tickers: [], marketPrices: {} });
  });

  app.post("/api/tickers/update-manual", (req, res) => {
    const { symbol, price } = req.body;
    db.prepare("UPDATE tickers SET manual_price = ?, last_updated = CURRENT_TIMESTAMP WHERE symbol = ?")
      .run(price, symbol);
    res.json({ success: true });
  });

  // Global Error Handler for API routes
  app.use("/api", (err: any, req: any, res: any, next: any) => {
    console.error("API Error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  });

  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `Not Found: ${req.method} ${req.url}` });
  });

  // Vite setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Portfolio Server V2 running on http://localhost:${PORT}`);
  });
}

startServer();
