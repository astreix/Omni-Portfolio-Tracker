import React, { useState, useEffect } from 'react';
import { LayoutGrid, PieChart, ArrowUpRight, ArrowDownLeft, Import, Settings, Briefcase, Filter, LogOut, LogIn, TrendingUp, Calendar, Plus, Save, Search, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Ticker, Transaction, DividendRecorded, DividendSchedule, Holding, Account } from './types';
import { calculateHoldings, calculateIncomeForecast } from './lib/portfolioLogic';
// @ts-ignore
import { parse } from 'csv-parse/browser/esm/sync';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'holdings' | 'income' | 'import'>('dashboard');
  const [data, setData] = useState<{ 
    transactions: Transaction[], 
    dividends: DividendRecorded[], 
    schedules: DividendSchedule[],
    tickers: Ticker[],
    accounts: Account[],
    marketPrices: Record<string, number>
  }>({
    transactions: [],
    dividends: [],
    schedules: [],
    tickers: [],
    accounts: [],
    marketPrices: {}
  });
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<'Consolidated' | number>('Consolidated');
  
  // Form States (Simulating st.session_state)
  const [forms, setForms] = useState({
    accountName: '',
    manualTicker: '',
    manualPrice: '',
    divTicker: '',
    divExDate: '',
    divPayDate: '',
    divAmount: '',
    divWht: '0'
  });

  const [importStatus, setImportStatus] = useState('');
  const [csvInput, setCsvInput] = useState('');
  const [stagedTransactions, setStagedTransactions] = useState<any[]>([]);
  const [importAccountId, setImportAccountId] = useState<number | ''>('');
  const [tickerQuery, setTickerQuery] = useState('');
  const [tickerResults, setTickerResults] = useState<any[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    const safeFetch = async (url: string, options?: RequestInit) => {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return res.json();
      }
      const text = await res.text();
      throw new Error(`Expected JSON but got ${contentType || 'unknown'}. Body: ${text.slice(0, 100)}`);
    };

    try {
      const [txs, divs, schedules, accounts] = await Promise.all([
        safeFetch('/api/transactions'),
        safeFetch('/api/dividends-recorded'),
        safeFetch('/api/dividend-schedule'),
        safeFetch('/api/accounts')
      ]);
      
      setData(prev => ({ 
        ...prev, 
        transactions: Array.isArray(txs) ? txs : [], 
        dividends: Array.isArray(divs) ? divs : [], 
        schedules: Array.isArray(schedules) ? schedules : [], 
        accounts: Array.isArray(accounts) ? accounts : [] 
      }));
      
      if (txs.length > 0) {
        const symbols = [...new Set(txs.map((t: any) => t.ticker_symbol))];
        const res = await fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols })
        });
        if (res.ok) {
          const marketPrices = await res.json();
          setData(prev => ({ ...prev, marketPrices }));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchSearchResults = async () => {
      if (tickerQuery.length < 2) {
        setTickerResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(tickerQuery)}`);
        const results = await res.json();
        setTickerResults(results || []);
      } catch (e) {
        console.error(e);
      }
    };
    const timer = setTimeout(fetchSearchResults, 300);
    return () => clearTimeout(timer);
  }, [tickerQuery]);

  const handleAddAccount = async () => {
    if (!forms.accountName) return;
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: forms.accountName })
    });
    const newAcc = await res.json();
    setData(prev => ({ ...prev, accounts: [...prev.accounts, newAcc] }));
    setForms(f => ({ ...f, accountName: '' }));
  };

  const handleDeleteAccount = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this account? It must have no transactions.")) return;
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setData(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== id) }));
        if (selectedAccountId === id) setSelectedAccountId('Consolidated');
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete account");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const parseFlexibleDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const trimmed = dateStr.trim();
    
    // ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    
    // DD-Mon-YY (e.g. 21-Jan-22 or 21-Jan-2022)
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if (trimmed.includes('-')) {
      const parts = trimmed.split('-');
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const mIdx = monthNames.indexOf(parts[1].toLowerCase());
        if (mIdx !== -1) {
          const m = (mIdx + 1).toString().padStart(2, '0');
          let y = parts[2];
          if (y.length === 2) y = `20${y}`;
          return `${y}-${m}-${d}`;
        }
      }
    }

    // DD/MM/YYYY
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/');
      if (parts.length === 3) {
        let d = parts[0].padStart(2, '0');
        let m = parts[1].padStart(2, '0');
        let y = parts[2];
        if (y.length === 2) y = `20${y}`;
        // Verify if it looks like DD/MM/YYYY or MM/DD/YYYY? Standard usually DD/MM/YYYY in UK/Refinitiv
        return `${y}-${m}-${d}`;
      }
    }

    return '';
  };

  const processCsvContent = (content: string) => {
    try {
      const result = parse(content, { 
        columns: true, 
        skip_empty_lines: true, 
        trim: true, 
        relax_column_count: true,
        skip_records_with_error: true
      });
      
      const aliases = {
        ticker: ['Ticker', 'Symbol', 'Asset'],
        quantity: ['Quantity', 'Qty', 'Units/PAR', 'Units'],
        price: ['Purchase Price', 'Price', 'Trade Amount'],
        currency: ['Purchase currency', 'Currency', 'Local Currency'],
        date: ['Date', 'Trade Date'],
        fx: ['FX Rate', 'Exchange Rate'],
        fees: ['Fees', 'Commission', 'Trade Fees']
      };

      const getVal = (item: any, keys: string[]) => {
        for (const k of keys) {
          if (item[k] !== undefined) return item[k];
        }
        return '';
      };

      const mapped = result.map((item: any, index: number) => {
        const errors: string[] = [];
        
        const rawTicker = getVal(item, aliases.ticker);
        let ticker = (rawTicker || '').toString().split(',')[0].trim();
        
        // Smart Ticker Correction
        if (ticker.includes(':')) {
          const parts = ticker.split(':');
          const exchange = parts[0].trim();
          const sym = parts[1].trim();
          if (exchange === 'LON') ticker = `${sym}.L`;
          else if (exchange === 'HKG') ticker = `${sym.padStart(4, '0')}.HK`;
          else if (exchange === 'TSE' || exchange === 'TSX') ticker = `${sym}.TO`;
        }

        const rawQty = getVal(item, aliases.quantity);
        let qty = parseFloat(rawQty || '0');
        
        const rawPriceLine = getVal(item, aliases.price);
        const rawPrice = parseFloat(rawPriceLine || '0');
        
        const rawFx = getVal(item, aliases.fx) || '1';
        const fxRate = parseFloat(rawFx);

        const rawFees = getVal(item, aliases.fees) || '0';
        const fees = parseFloat(rawFees);
        
        const rawCurrency = getVal(item, aliases.currency) || 'GBP';
        const currency = rawCurrency.trim();
        
        const rawDate = getVal(item, aliases.date);
        const dateStr = parseFlexibleDate(rawDate);
        
        if (!ticker) errors.push('Missing Ticker');
        if (isNaN(qty) || qty === 0) errors.push('Invalid Quantity');
        if (isNaN(rawPrice) || rawPrice === 0) errors.push('Invalid Price');
        if (!dateStr) errors.push('Invalid Date Format');

        // Derived Logic
        let priceGbp = rawPrice;
        if (currency.toUpperCase() === 'GBP') {
          priceGbp = rawPrice;
        } else if (currency.toUpperCase() === 'GBp' || currency === 'GBp') {
          priceGbp = rawPrice / 100;
        } else {
          priceGbp = rawPrice / (fxRate || 1);
        }

        return {
          id: `staging-${index}-${Date.now()}`,
          ticker_symbol: ticker,
          type: qty < 0 ? 'Sell' : 'Buy',
          date: dateStr || '',
          rawDate: rawDate,
          quantity: Math.abs(isNaN(qty) ? 0 : qty),
          price: isNaN(rawPrice) ? 0 : rawPrice,
          currency: currency,
          fx_rate: isNaN(fxRate) ? 1 : fxRate,
          fees: isNaN(fees) ? 0 : fees,
          total_gbp: (Math.abs(isNaN(qty) ? 0 : qty) * priceGbp) + (isNaN(fees) ? 0 : fees),
          errors: errors
        };
      });

      setStagedTransactions(mapped);
      setImportStatus(mapped.some(m => m.errors.length > 0) ? 'Errors found in CSV' : 'CSV parsed successfully');
    } catch (e: any) {
      setImportStatus(`Parse Error: ${e.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processCsvContent(content);
    };
    reader.readAsText(file);
  };

  const commitStaged = async () => {
    if (importAccountId === '') {
      setImportStatus('Please select a Target Account first.');
      return;
    }

    const valid = stagedTransactions.filter(t => t.errors.length === 0);
    if (valid.length === 0) {
      setImportStatus('No valid records to commit.');
      return;
    }

    setImportStatus('Committing changes...');
    const mappedToApi = valid.map(t => ({
      ticker_symbol: t.ticker_symbol,
      account_id: importAccountId,
      type: t.type,
      date: t.date,
      quantity: t.quantity,
      price: t.price,
      currency: t.currency,
      fx_rate: t.fx_rate,
      fees: t.fees,
      total_gbp: t.total_gbp
    }));

    try {
      const res = await fetch('/api/batches/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: mappedToApi })
      });
      
      const summary = await res.json();
      
      if (!res.ok) {
        throw new Error(summary.error || 'Server rejected the batch.');
      }

      setImportStatus(`Successfully imported ${summary.imported} records.`);
      setStagedTransactions([]);
      fetchInitialData();
    } catch (e: any) {
      setImportStatus(`Commit Failed: ${e.message}`);
    }
  };

  const handleAddManualDividend = async () => {
    if (!forms.divTicker || !forms.divAmount) return;
    try {
      const res = await fetch('/api/dividend-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: forms.divTicker,
          ex_date: forms.divExDate,
          pay_date: forms.divPayDate,
          amount_per_share: parseFloat(forms.divAmount),
          currency: 'GBP',
          wht_rate: parseFloat(forms.divWht) || 0
        })
      });
      if (res.ok) {
        fetchInitialData();
        setForms(f => ({ ...f, divTicker: '', divExDate: '', divPayDate: '', divAmount: '', divWht: '0' }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const holdings = calculateHoldings(data.transactions, data.dividends, data.tickers, data.marketPrices, data.accounts, selectedAccountId);
  const forecast = calculateIncomeForecast(holdings, data.schedules);

  const totalValuation = holdings.reduce((sum, h) => sum + h.currentValueGbp, 0);
  const totalDividends = data.dividends.reduce((sum, d) => sum + (d.amount_gbp - d.wht_gbp), 0);
  const upcomingIncome = forecast[0]?.amount || 0;

  if (loading) return <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-indigo-400">Loading Portfolio...</div>;

  return (
    <div className="flex h-screen bg-slate-950 font-sans text-slate-100 overflow-hidden">
      {/* Sidebar - Pro Design */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <h1 className="font-black text-xl tracking-tighter text-indigo-500 uppercase italic">Omni-Vault</h1>
          <p className="text-[10px] text-slate-500 font-bold tracking-[0.2em] mt-1">PRO ASSET TRACKER</p>
        </div>

        <nav className="flex-1 p-4 space-y-8 overflow-y-auto">
          <div>
            <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mb-4 px-2">Navigation</p>
            <SidebarItem icon={<LayoutGrid size={18}/>} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <SidebarItem icon={<PieChart size={18}/>} label="Holdings" active={activeTab === 'holdings'} onClick={() => setActiveTab('holdings')} />
            <SidebarItem icon={<TrendingUp size={18}/>} label="Income" active={activeTab === 'income'} onClick={() => setActiveTab('income')} />
            <SidebarItem icon={<Import size={18}/>} label="Maintenance" active={activeTab === 'import'} onClick={() => setActiveTab('import')} />
          </div>

          <div>
            <p className="text-[10px] text-slate-600 font-black uppercase tracking-widest mb-4 px-2">Accounts</p>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedAccountId('Consolidated')}
                className={`w-full text-left px-3 py-2 rounded text-xs font-bold transition-all ${selectedAccountId === 'Consolidated' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Consolidated
              </button>
              {data.accounts.map(acc => (
                <div key={acc.id} className="group relative">
                  <button
                    onClick={() => setSelectedAccountId(acc.id)}
                    className={`w-full text-left px-3 py-2 rounded text-xs font-bold transition-all pr-8 ${selectedAccountId === acc.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {acc.name}
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acc.id); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            
            <div className="mt-4 px-3 space-y-2">
              <input 
                type="text" 
                placeholder="New Account..."
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-[11px] focus:ring-1 focus:ring-indigo-500 outline-none"
                value={forms.accountName}
                onChange={e => setForms(fs => ({ ...fs, accountName: e.target.value }))}
              />
              <button 
                onClick={handleAddAccount}
                className="w-full bg-slate-700 hover:bg-slate-600 text-[10px] font-black py-1.5 rounded uppercase tracking-widest transition-colors"
              >
                + Create Account
              </button>
            </div>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-950 p-8 custom-scrollbar">
        <header className="flex justify-between items-center mb-10">
          <div>
            <h2 className="text-3xl font-black tracking-tighter text-white uppercase italic">{activeTab}</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Portfolio Base: GBP • Net of Tax Performance</p>
          </div>
          <div className="flex gap-4">
             <div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 flex items-center gap-3">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live Market Feed</span>
             </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="db" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricCard label="Portfolio Value" value={`£${totalValuation.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="Current Market Value" color="text-indigo-400" />
                <MetricCard label="Total Dividends (Net)" value={`£${totalDividends.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="Lifetime Realized Cashflow" color="text-emerald-400" />
                <MetricCard label="Upcoming Income" value={`£${upcomingIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} sub="Projected Next 30 Days" color="text-amber-400" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-6">Income Forecast (Net GBP)</p>
                    <div className="flex items-end h-40 gap-2">
                       {forecast.slice(0, 6).map((f, i) => (
                         <div key={i} className="flex-1 flex flex-col items-center gap-2">
                            <div className="w-full bg-indigo-500/20 rounded-t relative group" style={{ height: `${Math.min(100, (f.amount / (Math.max(...forecast.map(v => v.amount)) || 1)) * 100)}%` }}>
                               <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-40 transition-opacity rounded-t"></div>
                            </div>
                            <span className="text-[9px] font-bold text-slate-500 uppercase">{f.month.split(' ')[0]}</span>
                         </div>
                       ))}
                    </div>
                 </div>
                 
                 <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-6">Top Holdings (Weight %)</p>
                    <div className="space-y-4">
                       {holdings.slice(0, 4).map(h => (
                         <div key={h.symbol} className="space-y-1.5">
                            <div className="flex justify-between text-[10px] font-black uppercase">
                               <span className="text-slate-400">{h.symbol}</span>
                               <span className="text-indigo-400">{((h.currentValueGbp / totalValuation) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                               <div className="h-full bg-indigo-500" style={{ width: `${totalValuation > 0 ? (h.currentValueGbp / totalValuation) * 100 : 0}%` }}></div>
                            </div>
                         </div>
                       ))}
                    </div>
                 </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'holdings' && (
            <motion.div key="hold" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-slate-900/50 rounded-xl border border-slate-800/50 overflow-hidden">
               <table className="w-full text-left">
                 <thead className="bg-slate-900 border-b border-slate-800">
                   <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">
                     <th className="px-6 py-5">Asset</th>
                     <th className="px-6 py-5">Qty</th>
                     <th className="px-6 py-5">Avg Cost</th>
                     <th className="px-6 py-5">Current</th>
                     <th className="px-6 py-5">Value (GBP)</th>
                     <th className="px-6 py-5 text-right">Day Return</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800/50">
                   {holdings.map(h => (
                     <tr key={h.symbol} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                           <div className="text-xs font-black text-white">{h.symbol}</div>
                           <div className="text-[10px] text-slate-500 font-bold uppercase truncate max-w-[120px]">{h.name}</div>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">{h.quantity.toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">£{h.avgCostGbp.toFixed(2)}</td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">£{h.currentPrice.toFixed(2)}</td>
                        <td className="px-6 py-4 text-xs font-black text-indigo-400">£{h.currentValueGbp.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className={`px-6 py-4 text-right text-[11px] font-black italic ${h.totalReturn >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                           {h.totalReturn >= 0 ? '▲' : '▼'} {(Math.abs(h.totalReturn) * 100).toFixed(2)}%
                        </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </motion.div>
          )}

          {activeTab === 'income' && (
            <motion.div key="inc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-3 gap-8">
               <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50">
                  <h3 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2"><Plus size={16} className="text-indigo-400" /> Manual Record</h3>
                  <div className="space-y-4">
                     <FormInput label="Ticker Symbol" value={forms.divTicker} onChange={v => setForms(f => ({ ...f, divTicker: v }))} />
                     <div className="grid grid-cols-2 gap-4">
                        <FormInput label="Ex-Date" type="date" value={forms.divExDate} onChange={v => setForms(f => ({ ...f, divExDate: v }))} />
                        <FormInput label="Pay Date" type="date" value={forms.divPayDate} onChange={v => setForms(f => ({ ...f, divPayDate: v }))} />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <FormInput label="Div/Share" type="number" value={forms.divAmount} onChange={v => setForms(f => ({ ...f, divAmount: v }))} />
                        <FormInput label="WHT Rate" type="number" value={forms.divWht} onChange={v => setForms(f => ({ ...f, divWht: v }))} />
                     </div>
                     <button 
                        onClick={handleAddManualDividend}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black py-2.5 rounded uppercase tracking-widest mt-4 flex items-center justify-center gap-2"
                      >
                        <Save size={14} /> Commit Record
                     </button>
                  </div>
               </div>

               <div className="md:col-span-2 space-y-8">
                  <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50 overflow-hidden">
                     <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4 italic">Upcoming 12-Month Projected Income (GBP Net)</p>
                     <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        <table className="w-full text-left">
                           <thead className="sticky top-0 bg-slate-900 border-b border-slate-800">
                             <tr className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                               <th className="py-3">Month</th>
                               <th className="py-3 text-right">Estimated Net</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-800/50">
                             {forecast.map(f => (
                               <tr key={f.month} className="group">
                                  <td className="py-4 text-[11px] font-bold text-slate-300">{f.month}</td>
                                  <td className="py-4 text-right text-[11px] font-black text-emerald-400">£{f.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                               </tr>
                             ))}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            </motion.div>
          )}

          {activeTab === 'import' && (
            <motion.div key="imp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl space-y-8 pb-20">
               <div className="bg-slate-900/50 p-8 rounded-xl border border-slate-800/50">
                  <h2 className="text-xl font-black mb-2 uppercase italic">Data Maintenance Hub</h2>
                  <p className="text-[10px] text-slate-500 font-bold mb-8 uppercase tracking-widest leading-relaxed">
                    Overhaul your portfolio with batch imports. Multi-header compatibility enabled.
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    
                    <div className="lg:col-span-2 space-y-6">
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
                        <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4 block">1. Select Target Account</label>
                        {data.accounts.length === 0 ? (
                          <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded text-xs font-bold text-rose-400">
                            No accounts found. Please create an account in the sidebar first.
                          </div>
                        ) : (
                          <select 
                            value={importAccountId}
                            onChange={(e) => setImportAccountId(e.target.value ? Number(e.target.value) : '')}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-3 text-xs font-black text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500 transition-all appearance-none cursor-pointer"
                          >
                            <option value="">-- Choose Account --</option>
                            {data.accounts.map(acc => (
                              <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-slate-800 rounded-xl p-8 text-center hover:border-indigo-500 transition-all cursor-pointer relative group bg-slate-950/20">
                          <input 
                            type="file" 
                            accept=".csv"
                            onChange={handleFileUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <Import size={24} className="mx-auto text-slate-700 mb-2 group-hover:text-indigo-500 transition-colors" />
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Upload CSV</p>
                        </div>
                        
                        <div className="relative">
                          <textarea 
                            className="w-full h-28 bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-indigo-300 outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Paste CSV rows here..."
                            value={csvInput}
                            onChange={e => setCsvInput(e.target.value)}
                          />
                          <button 
                            onClick={() => processCsvContent(csvInput)}
                            className="absolute bottom-3 right-3 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-widest text-slate-100 transition-colors"
                          >
                            Map Data
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50 h-full">
                       <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">Live Symbol Lookup</h3>
                       <div className="relative mb-6">
                          <input 
                            type="text" 
                            placeholder="Search Yahoo..."
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2.5 text-xs font-bold text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500 shadow-inner"
                            value={tickerQuery}
                            onChange={e => setTickerQuery(e.target.value)}
                          />
                       </div>
                       
                       <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                          {tickerResults.map((r, idx) => (
                            <div 
                              key={idx} 
                              className="text-[10px] bg-slate-950/50 border border-slate-800 p-2.5 rounded flex justify-between items-center cursor-pointer hover:bg-indigo-500/10 transition-colors group"
                              onClick={() => {
                                navigator.clipboard.writeText(r.symbol);
                                setImportStatus(`Copied ${r.symbol}`);
                              }}
                            >
                              <span className="font-black text-indigo-400">{r.symbol}</span>
                              <span className="text-slate-600 group-hover:text-slate-400 truncate ml-2 transition-colors">{r.shortname || r.longname}</span>
                            </div>
                          ))}
                          {tickerQuery.length >= 2 && tickerResults.length === 0 && (
                            <p className="text-center py-4 text-[9px] font-bold text-slate-700 uppercase tracking-[0.2em]">Searching Alpha...</p>
                          )}
                       </div>
                    </div>
                  </div>

                  {stagedTransactions.length > 0 && (
                    <div className="mt-10 space-y-6">
                      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-widest text-white italic">Stage Area</h3>
                          <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">{stagedTransactions.length} items parsed</p>
                        </div>
                        <div className="flex gap-6 items-center">
                          <span className={`text-[10px] font-black uppercase tracking-widest transition-all ${importStatus.includes('Error') ? 'text-rose-500' : 'text-indigo-400'}`}>{importStatus}</span>
                          <button 
                            onClick={commitStaged}
                            disabled={stagedTransactions.some(t => t.errors.length > 0) || importAccountId === ''}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-20 text-white px-10 py-3 rounded font-black text-[11px] uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20 active:scale-95"
                          >
                            Vault Commit
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/50">
                        <table className="w-full text-left">
                          <thead className="bg-slate-900 border-b border-slate-800">
                            <tr className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">
                              <th className="px-6 py-5">Ticker</th>
                              <th className="px-6 py-5">Date (YYYY-MM-DD)</th>
                              <th className="px-6 py-5">Qty</th>
                              <th className="px-6 py-5">Value/FX</th>
                              <th className="px-6 py-5 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                              {stagedTransactions.map((st, i) => {
                                const hasErrors = st.errors.length > 0;
                                return (
                                  <tr key={st.id} className={`group ${hasErrors ? 'bg-rose-500/5' : 'hover:bg-slate-900/30'} transition-all`}>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-2">
                                        <input 
                                          className={`bg-slate-900 border ${hasErrors && st.errors.includes('Missing Ticker') ? 'border-rose-500' : 'border-slate-800'} rounded text-[11px] font-black text-white px-2 py-1 outline-none focus:border-indigo-500 w-24`}
                                          value={st.ticker_symbol}
                                          onChange={e => {
                                            const newTxs = [...stagedTransactions];
                                            newTxs[i].ticker_symbol = e.target.value;
                                            // Simple re-validation
                                            newTxs[i].errors = newTxs[i].errors.filter((er: string) => er !== 'Missing Ticker');
                                            if (!e.target.value) newTxs[i].errors.push('Missing Ticker');
                                            setStagedTransactions(newTxs);
                                          }}
                                        />
                                        <Search size={10} className="text-slate-700 group-hover:text-indigo-500 cursor-pointer transition-colors" onClick={() => setTickerQuery(st.ticker_symbol)} />
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <input 
                                        className={`bg-slate-900 border ${hasErrors && st.errors.includes('Invalid Date Format') ? 'border-rose-500' : 'border-slate-800'} rounded text-[11px] font-bold text-slate-400 px-2 py-1 outline-none focus:border-white w-32`}
                                        value={st.date}
                                        placeholder="YYYY-MM-DD"
                                        onChange={e => {
                                          const newTxs = [...stagedTransactions];
                                          newTxs[i].date = e.target.value;
                                          newTxs[i].errors = newTxs[i].errors.filter((er: string) => er !== 'Invalid Date Format');
                                          if (!/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) newTxs[i].errors.push('Invalid Date Format');
                                          setStagedTransactions(newTxs);
                                        }}
                                      />
                                    </td>
                                    <td className="px-6 py-4">
                                      <input 
                                        type="number"
                                        className={`bg-slate-900 border ${hasErrors && st.errors.includes('Invalid Quantity') ? 'border-rose-500' : 'border-slate-800'} rounded text-[11px] font-mono text-slate-400 px-2 py-1 outline-none focus:border-indigo-500 w-24`}
                                        value={st.quantity}
                                        onChange={e => {
                                          const v = parseFloat(e.target.value);
                                          const newTxs = [...stagedTransactions];
                                          newTxs[i].quantity = isNaN(v) ? 0 : v;
                                          newTxs[i].errors = newTxs[i].errors.filter((er: string) => er !== 'Invalid Quantity');
                                          if (isNaN(v) || v === 0) newTxs[i].errors.push('Invalid Quantity');
                                          setStagedTransactions(newTxs);
                                        }}
                                      />
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex flex-col gap-1">
                                        <input 
                                          type="number"
                                          className={`bg-slate-900 border ${hasErrors && st.errors.includes('Invalid Price') ? 'border-rose-500' : 'border-slate-800'} rounded text-[10px] font-mono text-slate-500 px-2 py-1 outline-none focus:border-indigo-500 w-24`}
                                          value={st.price}
                                          onChange={e => {
                                            const v = parseFloat(e.target.value);
                                            const newTxs = [...stagedTransactions];
                                            newTxs[i].price = isNaN(v) ? 0 : v;
                                            newTxs[i].errors = newTxs[i].errors.filter((er: string) => er !== 'Invalid Price');
                                            if (isNaN(v) || v === 0) newTxs[i].errors.push('Invalid Price');
                                            setStagedTransactions(newTxs);
                                          }}
                                        />
                                        <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest pl-1">{st.currency} (FX: {st.fx_rate})</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <div className="flex items-center justify-end gap-3">
                                        {hasErrors ? (
                                          <div className="flex flex-col items-end">
                                            {st.errors.map((er: string, idx: number) => (
                                              <span key={idx} className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">{er}</span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">READY</span>
                                        )}
                                        <button 
                                          onClick={() => setStagedTransactions(prev => prev.filter((_, idx) => idx !== i))}
                                          className="text-slate-700 hover:text-rose-500 transition-colors p-1"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-bold transition-all uppercase tracking-widest ${active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
    >
      <span className={active ? "text-white" : "text-slate-600"}>{icon}</span>
      {label}
    </button>
  );
}

function MetricCard({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors">
       <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] mb-4">{label}</p>
       <p className={`text-3xl font-black tracking-tighter ${color} italic underline decoration-slate-800 underline-offset-8`}>{value}</p>
       <p className="text-[10px] font-bold text-slate-500 mt-4 uppercase tracking-widest">{sub}</p>
    </div>
  );
}

function FormInput({ label, type = 'text', value, onChange }: { label: string, type?: string, value: string, onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
       <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest px-1">{label}</label>
       <input 
         type={type} 
         className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-bold text-indigo-400 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
         value={value}
         onChange={e => onChange(e.target.value)}
       />
    </div>
  );
}
