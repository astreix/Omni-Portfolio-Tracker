import React, { useState, useEffect } from 'react';
import { LayoutGrid, PieChart, ArrowUpRight, ArrowDownLeft, Import, Settings, Briefcase, Filter, LogOut, LogIn, TrendingUp, Calendar, Plus, Save } from 'lucide-react';
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
  const [tickerQuery, setTickerQuery] = useState('');
  const [tickerResults, setTickerResults] = useState<any[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [txs, divs, schedules, accounts] = await Promise.all([
        fetch('/api/transactions').then(r => r.json()),
        fetch('/api/dividends-recorded').then(r => r.json()),
        fetch('/api/dividend-schedule').then(r => r.json()),
        fetch('/api/accounts').then(r => r.json())
      ]);
      
      setData(prev => ({ ...prev, transactions: txs, dividends: divs, schedules: schedules, accounts }));
      
      if (txs.length > 0) {
        const symbols = [...new Set(txs.map((t: any) => t.ticker_symbol))];
        const res = await fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols })
        });
        const marketPrices = await res.json();
        setData(prev => ({ ...prev, marketPrices }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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

  const processCsvContent = (content: string) => {
    if (selectedAccountId === 'Consolidated') {
      alert('Please select a specific account in the sidebar before importing.');
      return;
    }
    
    try {
      const result = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
      
      const mapped = result.map((item: any, index: number) => {
        const errors: string[] = [];
        let ticker = (item['Ticker'] || '').split(',')[0].trim(); // Handle "LON:DEC"
        
        // Smart Ticker Correction (Yahoo formats)
        if (ticker.includes(':')) {
          const [exchange, sym] = ticker.split(':');
          if (exchange === 'LON') ticker = `${sym}.L`;
          else if (exchange === 'HKG') ticker = `${sym.padStart(4, '0')}.HK`;
          else if (exchange === 'TSE') ticker = `${sym}.TO`;
        }

        let qty = parseFloat(item['Quantity'] || '0');
        const rawPrice = parseFloat(item['Purchase Price'] || item['Price'] || '0');
        const fxRate = parseFloat(item['FX Rate'] || '1');
        const rawCurrency = item['Purchase currency'] || item['Currency'] || 'GBP';
        const currency = rawCurrency.trim();
        
        if (isNaN(qty)) errors.push(`Invalid Quantity: ${item['Quantity']}`);
        if (isNaN(rawPrice)) errors.push(`Invalid Price: ${item['Purchase Price'] || item['Price']}`);

        // Parse Date (21-Jan-22)
        let dateStr = item['Date'] || '';
        if (dateStr.includes('-')) {
          const parts = dateStr.split('-');
          if (parts.length === 3) {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthIdx = monthNames.findIndex(m => m.toLowerCase() === parts[1].toLowerCase());
            if (monthIdx !== -1) {
              const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
              dateStr = `${year}-${(monthIdx + 1).toString().padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
          }
        }
        
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          errors.push(`Invalid Date format: ${item['Date']}. Expected DD-Mon-YY.`);
        }

        let priceGbp = rawPrice;
        if (currency.toLowerCase() === 'gbp') priceGbp = rawPrice;
        else if (currency.toLowerCase() === 'gbp') priceGbp = rawPrice / 100;
        else priceGbp = rawPrice / fxRate;

        const totalGbp = Math.abs(qty) * priceGbp;

        return {
          id: `staging-${index}`,
          ticker_symbol: ticker,
          type: qty < 0 ? 'Sell' : 'Buy',
          date: dateStr,
          quantity: Math.abs(qty),
          price: rawPrice,
          currency: currency,
          fx_rate: fxRate,
          total_gbp: totalGbp,
          errors: errors
        };
      });

      setStagedTransactions(mapped);
      setImportStatus(mapped.some(m => m.errors.length > 0) ? 'Action Required: Fix errors below' : 'Review Staged Data');
    } catch (e: any) {
      alert(`Critical Parsing Error: ${e.message}\nMake sure your CSV has the correct headers.`);
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
    const valid = stagedTransactions.filter(t => t.errors.length === 0);
    if (valid.length === 0) return;

    setImportStatus('Committing changes...');
    const mappedToApi = valid.map(t => ({
      ...t,
      account_id: selectedAccountId
    }));

    try {
      const res = await fetch('/api/batches/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: mappedToApi })
      });
      const summary = await res.json();
      setImportStatus(`Imported ${summary.imported} records. ${summary.skipped} duplicates skipped.`);
      setStagedTransactions([]);
      fetchInitialData();
    } catch (e) {
      setImportStatus('Error during commit');
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
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`w-full text-left px-3 py-2 rounded text-xs font-bold transition-all ${selectedAccountId === acc.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  {acc.name}
                </button>
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
                               <div className="h-full bg-indigo-500" style={{ width: `${(h.currentValueGbp / totalValuation) * 100}%` }}></div>
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
                     <button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black py-2.5 rounded uppercase tracking-widest mt-4 flex items-center justify-center gap-2">
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
                  <h2 className="text-xl font-black mb-4 uppercase italic">Portfolio Maintenance</h2>
                  <p className="text-xs text-slate-500 font-bold mb-8 uppercase leading-relaxed">
                    Import transactions to <span className="text-indigo-400">{selectedAccountId === 'Consolidated' ? 'Selected Account' : data.accounts.find(a => a.id === selectedAccountId)?.name}</span>.
                  </p>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="border-2 border-dashed border-slate-800 rounded-xl p-8 text-center hover:border-indigo-500 transition-all cursor-pointer relative group">
                        <input 
                          type="file" 
                          accept=".csv"
                          onChange={handleFileUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <Import size={32} className="mx-auto text-slate-700 mb-4 group-hover:text-indigo-500 transition-colors" />
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Drop CSV or Click to Upload</p>
                      </div>
                      
                      <div className="relative">
                        <textarea 
                          className="w-full h-40 bg-slate-950 border border-slate-800 rounded-lg p-6 font-mono text-[11px] text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="Or paste Ticker,Date,Quantity,Price... records here"
                          value={csvInput}
                          onChange={e => setCsvInput(e.target.value)}
                        />
                        <button 
                          onClick={() => processCsvContent(csvInput)}
                          className="absolute bottom-4 right-4 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded text-[10px] font-black uppercase tracking-widest"
                        >
                          Parse Input
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800/50">
                       <h3 className="text-sm font-black uppercase tracking-widest mb-4 italic">Ticker Reference</h3>
                       <div className="relative mb-4">
                          <input 
                            type="text" 
                            placeholder="Search Yahoo symbols..."
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-bold text-indigo-400 outline-none focus:ring-1 focus:ring-indigo-500"
                            value={tickerQuery}
                            onChange={e => {
                              setTickerQuery(e.target.value);
                              // Simple debounce logic if needed
                            }}
                          />
                       </div>
                       <p className="text-[10px] text-slate-600 font-bold leading-relaxed">
                         US: RELX<br/>
                         London: REL.L<br/>
                         Brazil: PBR, PBR-A<br/>
                         Canada: NEO.TO
                       </p>
                    </div>
                  </div>

                  {stagedTransactions.length > 0 && (
                    <div className="mt-10 space-y-6">
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-black uppercase italic text-white">Staged transactions ({stagedTransactions.length})</h3>
                        <div className="flex gap-4 items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">{importStatus}</span>
                          <button 
                            onClick={commitStaged}
                            disabled={stagedTransactions.some(t => t.errors.length > 0)}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white px-8 py-2 rounded font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20"
                          >
                            Commit Valid Records
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/50">
                        <table className="w-full text-left">
                          <thead className="bg-slate-900 border-b border-slate-800">
                            <tr className="text-[9px] font-black text-slate-500 uppercase tracking-widest italic">
                              <th className="px-4 py-4">Ticker</th>
                              <th className="px-4 py-4">Date</th>
                              <th className="px-4 py-4">Qty</th>
                              <th className="px-4 py-4">Price</th>
                              <th className="px-4 py-4">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                            {stagedTransactions.map((st, i) => (
                              <tr key={i} className="group">
                                <td className="px-4 py-3">
                                  <input 
                                    className="bg-transparent border-none text-[11px] font-black text-white outline-none focus:text-indigo-400 w-20"
                                    value={st.ticker_symbol}
                                    onChange={e => {
                                      const newTxs = [...stagedTransactions];
                                      newTxs[i].ticker_symbol = e.target.value;
                                      setStagedTransactions(newTxs);
                                    }}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <input 
                                    type="date"
                                    className="bg-transparent border-none text-[11px] font-bold text-slate-400 outline-none focus:text-white"
                                    value={st.date}
                                    onChange={e => {
                                      const newTxs = [...stagedTransactions];
                                      newTxs[i].date = e.target.value;
                                      setStagedTransactions(newTxs);
                                    }}
                                  />
                                </td>
                                <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{st.quantity}</td>
                                <td className="px-4 py-3 text-[11px] font-mono text-slate-500">{st.price} {st.currency}</td>
                                <td className="px-4 py-3">
                                  {st.errors.length > 0 ? (
                                    <span className="text-[10px] font-black text-rose-500 uppercase">{st.errors[0]}</span>
                                  ) : (
                                    <span className="text-[10px] font-black text-emerald-500 uppercase">VALID</span>
                                  )}
                                </td>
                              </tr>
                            ))}
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
