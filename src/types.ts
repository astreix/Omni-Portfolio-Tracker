export interface Ticker {
  symbol: string;
  name: string;
  asset_class: string;
  is_manual: number;
  manual_price: number | null;
  last_updated: string;
}

export interface Account {
  id: number;
  name: string;
}

export interface Transaction {
  id: string;
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

export interface DividendRecorded {
  id: string;
  ticker: string;
  account_id: number;
  date: string;
  amount_gbp: number;
  wht_gbp: number;
}

export interface DividendSchedule {
  id: string;
  ticker: string;
  ex_date: string;
  pay_date: string;
  amount_per_share: number;
  currency: string;
  wht_rate: number;
}

export interface Holding {
  symbol: string;
  name: string;
  account: string;
  quantity: number;
  avgCostGbp: number;
  currentPrice: number;
  currentValueGbp: number;
  totalDividendsGbp: number;
  totalReturn: number;
  annualizedReturn: number;
}
