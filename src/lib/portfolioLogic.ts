import { Transaction, Holding, DividendRecorded, DividendSchedule, Ticker, Account } from '../types';
import { differenceInDays, addMonths, isAfter, isBefore } from 'date-fns';

export function calculateHoldings(
  transactions: Transaction[] = [], 
  dividends: DividendRecorded[] = [], 
  tickers: Ticker[] = [],
  marketPrices: Record<string, number> = {},
  accounts: Account[] = [],
  filterAccountId: number | 'Consolidated' = 'Consolidated'
): Holding[] {
  if (!Array.isArray(transactions) || !Array.isArray(dividends)) return [];

  const holdings: Record<string, { buys: Transaction[], sells: Transaction[] }> = {};

  // Filter by account if needed
  const filteredTxs = filterAccountId === 'Consolidated' 
    ? transactions 
    : transactions.filter(t => t.account_id === filterAccountId);

  const filteredDivs = filterAccountId === 'Consolidated'
    ? dividends
    : dividends.filter(d => d.account_id === filterAccountId);

  // Group by Ticker and Account
  filteredTxs.forEach(tx => {
    const key = `${tx.ticker_symbol}|${tx.account_id}`;
    if (!holdings[key]) holdings[key] = { buys: [], sells: [] };
    if (tx.type === 'Buy') holdings[key].buys.push({ ...tx });
    else holdings[key].sells.push({ ...tx });
  });

  const results: Holding[] = [];

  Object.entries(holdings).forEach(([key, { buys, sells }]) => {
    const [symbol, accountIdStr] = key.split('|');
    const accountId = parseInt(accountIdStr);
    const account = accounts.find(a => a.id === accountId)?.name || 'Unknown';
    const tickerInfo = tickers.find(t => t.symbol === symbol);
    
    // Sort buys by date for FIFO
    buys.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    let remainingLots = buys.map(b => ({ ...b }));
    
    // Apply sells using FIFO
    sells.forEach(sell => {
      let qtyToSell = sell.quantity;
      while (qtyToSell > 0 && remainingLots.length > 0) {
        if (remainingLots[0].quantity <= qtyToSell) {
          qtyToSell -= remainingLots[0].quantity;
          remainingLots.shift();
        } else {
          remainingLots[0].quantity -= qtyToSell;
          qtyToSell = 0;
        }
      }
    });

    const totalQty = remainingLots.reduce((sum, b) => sum + b.quantity, 0);
    if (totalQty <= 0) return;

    // Cost basis calculation (FIFO)
    // We need to properly track the GBP cost of each lot
    const totalCostGbp = remainingLots.reduce((sum, b) => sum + (b.total_gbp * (b.quantity / transactions.find(t => t.id === b.id)!.quantity)), 0);
    const avgCostGbp = totalQty > 0 ? totalCostGbp / totalQty : 0;
    
    const currentPrice = tickerInfo?.is_manual ? (tickerInfo.manual_price || 0) : (marketPrices[symbol] || 0);
    const currentValueGbp = totalQty * currentPrice; 
    
    const tickerDivs = filteredDivs.filter(d => d.ticker === symbol && d.account_id === accountId);
    // Net Dividends (Amount - WHT)
    const totalDividendsGbp = tickerDivs.reduce((sum, d) => sum + (d.amount_gbp - d.wht_gbp), 0);

    const totalReturn = ((currentValueGbp + totalDividendsGbp) - totalCostGbp) / totalCostGbp;

    // CAGR calculation
    const oldestBuyDate = new Date(remainingLots[0].date);
    const daysHeld = differenceInDays(new Date(), oldestBuyDate);
    const yearsHeld = daysHeld / 365.25;
    const annualizedReturn = yearsHeld > 0 
      ? Math.pow((currentValueGbp + totalDividendsGbp) / totalCostGbp, 1 / yearsHeld) - 1
      : totalReturn;

    results.push({
      symbol,
      name: tickerInfo?.name || symbol,
      account,
      quantity: totalQty,
      avgCostGbp,
      currentPrice,
      currentValueGbp,
      totalDividendsGbp,
      totalReturn,
      annualizedReturn
    });
  });

  return results;
}

export function calculateIncomeForecast(
  holdings: Holding[],
  schedules: DividendSchedule[] = [],
  months: number = 12
) {
  const now = new Date();
  const end = addMonths(now, months);
  
  const forecast: { month: string, amount: number, details: any[] }[] = [];
  
  for (let i = 0; i < months; i++) {
    const monthDate = addMonths(now, i);
    const monthKey = monthDate.toLocaleString('default', { month: 'short', year: 'numeric' });
    forecast.push({ month: monthKey, amount: 0, details: [] });
  }

  if (Array.isArray(schedules)) {
    schedules.forEach(sec => {
      const payDate = new Date(sec.pay_date);
      if (isAfter(payDate, now) && isBefore(payDate, end)) {
        const holding = holdings.find(h => h.symbol === sec.ticker);
        if (holding && holding.quantity > 0) {
          const netAmount = (sec.amount_per_share * holding.quantity) * (1 - sec.wht_rate);
          
          const actualIndex = (payDate.getMonth() - now.getMonth() + 12 * (payDate.getFullYear() - now.getFullYear()));
          
          if (actualIndex >= 0 && actualIndex < months) {
            forecast[actualIndex].amount += netAmount;
            forecast[actualIndex].details.push({
              ticker: sec.ticker,
              payDate: sec.pay_date,
              amount: netAmount
            });
          }
        }
      }
    });
  }

  return forecast;
}
