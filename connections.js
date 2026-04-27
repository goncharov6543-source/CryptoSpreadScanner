const axios = require('axios');
const crypto = require('crypto');

async function fetchBalances(apiKeys) {
    let totalBal = 0;
    let details = [];
    let hasError = false;

    const keys = Object.keys(apiKeys);
    if (keys.length === 0) return { total: 0, details: [], hasError: false };

    const promises = keys.map(async (ex) => {
        const { key, secret } = apiKeys[ex];
        let balance = 0;
        let errMessage = null;
        let isSuccess = false; 

        try {
            if (ex === 'MEXC') {
                try {
                    const ts = Date.now();
                    const q = `timestamp=${ts}`;
                    const sig = crypto.createHmac('sha256', secret).update(q).digest('hex');
                    const resSpot = await axios.get(`https://api.mexc.com/api/v3/account?${q}&signature=${sig}`, { headers: { 'X-MEXC-APIKEY': key } });
                    const usdtAsset = resSpot.data.balances.find(a => a.asset === 'USDT');
                    if (usdtAsset) balance += parseFloat(usdtAsset.free) + parseFloat(usdtAsset.locked);
                    isSuccess = true;
                } catch(e) { errMessage = e.response?.data?.msg || "Помилка MEXC Spot"; }

                try {
                    const tsFut = Date.now().toString();
                    const sigFut = crypto.createHmac('sha256', secret).update(key + tsFut).digest('hex');
                    const resFut = await axios.get('https://contract.mexc.com/api/v1/private/account/assets', {
                        headers: { 'ApiKey': key, 'Request-Time': tsFut, 'Signature': sigFut, 'Content-Type': 'application/json' }
                    });
                    const usdtFut = resFut.data.data.find(a => a.currency === 'USDT');
                    if (usdtFut) balance += parseFloat(usdtFut.availableBalance || 0) + parseFloat(usdtFut.frozenBalance || 0);
                    isSuccess = true;
                } catch(e) { 
                    if(!isSuccess) errMessage = e.response?.data?.msg || "Помилка MEXC Futures"; 
                }

                if (!isSuccess && !errMessage) throw new Error("Невірні ключі або немає прав");

            } else if (ex === 'Gate.io') {
                const ts = Math.floor(Date.now() / 1000).toString();
                const hash = crypto.createHash('sha512').update('').digest('hex');

                try {
                    const urlPathFut = '/api/v4/futures/usdt/accounts';
                    const sigStrFut = `GET\n${urlPathFut}\n\n${hash}\n${ts}`;
                    const sigFut = crypto.createHmac('sha512', secret).update(sigStrFut).digest('hex');
                    const resFut = await axios.get(`https://api.gateio.ws${urlPathFut}`, {
                        headers: { 'KEY': key, 'Timestamp': ts, 'SIGN': sigFut, 'Accept': 'application/json' }
                    });
                    balance += parseFloat(resFut.data.total || 0) + parseFloat(resFut.data.unrealised_pnl || 0);
                    isSuccess = true;
                } catch(e) { errMessage = e.response?.data?.message || "Помилка Gate.io Futures"; }

                try {
                    const urlPathSpot = '/api/v4/spot/accounts';
                    const sigStrSpot = `GET\n${urlPathSpot}\n\n${hash}\n${ts}`;
                    const sigSpot = crypto.createHmac('sha512', secret).update(sigStrSpot).digest('hex');
                    const resSpot = await axios.get(`https://api.gateio.ws${urlPathSpot}`, {
                        headers: { 'KEY': key, 'Timestamp': ts, 'SIGN': sigSpot, 'Accept': 'application/json' }
                    });
                    const usdtSpot = resSpot.data.find(a => a.currency === 'USDT');
                    if(usdtSpot) balance += parseFloat(usdtSpot.available || 0) + parseFloat(usdtSpot.locked || 0);
                    isSuccess = true;
                } catch(e) { 
                    if(!isSuccess) errMessage = e.response?.data?.message || "Помилка Gate.io Spot"; 
                }

                if (!isSuccess && !errMessage) throw new Error("Невірні ключі або немає прав");

            } else if (ex === 'Binance') {
                const ts = Date.now();
                const q = `timestamp=${ts}`;
                const sig = crypto.createHmac('sha256', secret).update(q).digest('hex');
                
                try {
                    const resSpot = await axios.get(`https://api.binance.com/api/v3/account?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key } });
                    const u = resSpot.data.balances.find(a => a.asset === 'USDT');
                    if(u) balance += parseFloat(u.free) + parseFloat(u.locked);
                    isSuccess = true;
                } catch(e) {}

                try {
                    const resFut = await axios.get(`https://fapi.binance.com/fapi/v2/balance?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key } });
                    const uF = resFut.data.find(a => a.asset === 'USDT');
                    if(uF) balance += parseFloat(uF.balance) + parseFloat(uF.crossUnPnl || 0);
                    isSuccess = true;
                } catch(e) { if(!isSuccess) errMessage = e.response?.data?.msg || "Помилка Binance"; }

            } else if (ex === 'Bybit') {
                const ts = Date.now().toString();
                const qs = 'accountType=UNIFIED';
                const sig = crypto.createHmac('sha256', secret).update(ts + key + '5000' + qs).digest('hex');
                
                try {
                    const res = await axios.get(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
                        headers: { 'X-BAPI-API-KEY': key, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' }
                    });
                    if (res.data.retCode === 0 && res.data.result.list.length > 0) {
                        balance += parseFloat(res.data.result.list[0].totalEquity || 0);
                        isSuccess = true;
                    } else { throw new Error(res.data.retMsg); }
                } catch(e) { errMessage = e.message || "Помилка Bybit"; }

            } else if (ex === 'Bitget') {
                errMessage = "Потребує поля Passphrase (у розробці)";
            }
        } catch (e) {
            if(!isSuccess) {
                errMessage = errMessage || e.response?.data?.msg || e.response?.data?.message || e.message || "Помилка підключення API";
                if(errMessage.length > 40) errMessage = errMessage.substring(0, 40) + '...'; 
            }
        }

        if (isSuccess) {
            errMessage = null; 
            totalBal += balance;
        } else {
            hasError = true;
        }

        details.push({ exchange: ex, balance, error: errMessage });
    });

    await Promise.all(promises);
    return { total: totalBal, details, hasError };
}

async function fetchPositions(apiKeys) {
    let allPositions = [];
    const keys = Object.keys(apiKeys);
    if (keys.length === 0) return [];

    const promises = keys.map(async (ex) => {
        const { key, secret } = apiKeys[ex];
        try {
            if (ex === 'Binance') {
                const ts = Date.now();
                const q = `timestamp=${ts}`;
                const sig = crypto.createHmac('sha256', secret).update(q).digest('hex');
                const res = await axios.get(`https://fapi.binance.com/fapi/v2/positionRisk?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key } });
                
                res.data.forEach(p => {
                    const posAmt = parseFloat(p.positionAmt);
                    if (posAmt !== 0) {
                        const entryPrice = parseFloat(p.entryPrice);
                        const sizeTokens = Math.abs(posAmt);
                        const sizeUSDT = sizeTokens * entryPrice; 
                        allPositions.push({
                            exchange: ex, symbol: p.symbol, cleanSymbol: p.symbol,
                            side: posAmt > 0 ? 'Long' : 'Short',
                            sizeUSDT: sizeUSDT, 
                            sizeTokens: sizeTokens, 
                            leverage: parseInt(p.leverage),
                            entryPrice: entryPrice,
                            unRealized: parseFloat(p.unRealizedProfit || 0),
                            realized: 0 
                        });
                    }
                });

            } else if (ex === 'Bybit') {
                const ts = Date.now().toString();
                const qs = 'category=linear&settleCoin=USDT';
                const sig = crypto.createHmac('sha256', secret).update(ts + key + '5000' + qs).digest('hex');
                const res = await axios.get(`https://api.bybit.com/v5/position/list?${qs}`, {
                    headers: { 'X-BAPI-API-KEY': key, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': '5000' }
                });
                
                if(res.data.retCode === 0 && res.data.result.list) {
                    res.data.result.list.forEach(p => {
                        const size = parseFloat(p.size);
                        if (size !== 0) {
                            const entryPrice = parseFloat(p.avgPrice);
                            const sizeTokens = Math.abs(size);
                            const sizeUSDT = sizeTokens * entryPrice; 
                            allPositions.push({
                                exchange: ex, symbol: p.symbol, cleanSymbol: p.symbol,
                                side: p.side === 'Buy' ? 'Long' : 'Short',
                                sizeUSDT: sizeUSDT,
                                sizeTokens: sizeTokens, 
                                leverage: parseInt(p.leverage),
                                entryPrice: entryPrice,
                                unRealized: parseFloat(p.unrealisedPnl || 0),
                                realized: parseFloat(p.cumRealisedPnl || 0)
                            });
                        }
                    });
                }

            } else if (ex === 'MEXC') {
                const ts = Date.now().toString();
                const sig = crypto.createHmac('sha256', secret).update(key + ts).digest('hex');
                
                const [posRes, tickerRes] = await Promise.all([
                    axios.get('https://contract.mexc.com/api/v1/private/position/open_positions', {
                        headers: { 'ApiKey': key, 'Request-Time': ts, 'Signature': sig, 'Content-Type': 'application/json' }
                    }).catch(e => { throw e; }),
                    axios.get('https://contract.mexc.com/api/v1/contract/ticker').catch(() => ({ data: { data: [] } }))
                ]);
                
                let mexcPrices = {};
                if (tickerRes.data && tickerRes.data.data) {
                    tickerRes.data.data.forEach(t => { mexcPrices[t.symbol] = parseFloat(t.lastPrice); });
                }
                
                if(posRes.data && posRes.data.data) {
                    posRes.data.data.forEach(p => {
                        if (parseFloat(p.holdVol) > 0) {
                            const entryPrice = parseFloat(p.holdAvgPrice);
                            const sizeTokens = parseFloat(p.holdVol);
                            const sizeUSDT = sizeTokens * entryPrice; 
                            const side = p.positionType === 1 ? 'Long' : 'Short';
                            
                            const currentPrice = mexcPrices[p.symbol] || entryPrice;
                            const manualUnrealized = side === 'Long' 
                                ? (currentPrice - entryPrice) * sizeTokens 
                                : (entryPrice - currentPrice) * sizeTokens;

                            allPositions.push({
                                exchange: ex, symbol: p.symbol, cleanSymbol: p.symbol.replace('_', ''),
                                side: side,
                                sizeUSDT: sizeUSDT, 
                                sizeTokens: sizeTokens, 
                                leverage: parseInt(p.leverage),
                                entryPrice: entryPrice,
                                unRealized: manualUnrealized,
                                realized: parseFloat(p.realised || 0)
                            });
                        }
                    });
                }

            } else if (ex === 'Gate.io') {
                const ts = Math.floor(Date.now() / 1000).toString();
                const hash = crypto.createHash('sha512').update('').digest('hex');
                const sigStr = `GET\n/api/v4/futures/usdt/positions\n\n${hash}\n${ts}`;
                const sig = crypto.createHmac('sha512', secret).update(sigStr).digest('hex');
                const res = await axios.get(`https://api.gateio.ws/api/v4/futures/usdt/positions`, {
                    headers: { 'KEY': key, 'Timestamp': ts, 'SIGN': sig, 'Accept': 'application/json' }
                });
                
                res.data.forEach(p => {
                    const size = parseFloat(p.size);
                    if (size !== 0) {
                        const entryPrice = parseFloat(p.entry_price);
                        const posValue = parseFloat(p.value); 
                        const sizeUSDT = !isNaN(posValue) ? posValue : (Math.abs(size) * entryPrice);
                        const sizeTokens = sizeUSDT / entryPrice; 

                        allPositions.push({
                            exchange: ex, symbol: p.contract, cleanSymbol: p.contract.replace('_', ''),
                            side: size > 0 ? 'Long' : 'Short',
                            sizeUSDT: sizeUSDT, 
                            sizeTokens: sizeTokens, 
                            leverage: parseInt(p.leverage) || 0,
                            entryPrice: entryPrice,
                            unRealized: parseFloat(p.unrealised_pnl) || 0, 
                            realized: parseFloat(p.realised_pnl) || 0
                        });
                    }
                });
            }
        } catch (e) { console.log(`Positions API error ${ex}:`, e.message); }
    });

    await Promise.all(promises);
    return allPositions;
}

module.exports = { fetchBalances, fetchPositions };