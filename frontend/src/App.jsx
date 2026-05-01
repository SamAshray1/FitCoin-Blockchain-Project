import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

window.ethers = ethers;

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const MARKET_ADDRESS = "0x9274D766A436C269A6DA880d3267Ff6107C1Ca85";
const YODA_ADDRESS = "0xbd27d0b7F9fedb5A2A2C3ceF5dC9c70f3CF64Af2"; 
const YODA_DECIMALS = 2;

const ABI = [
  "function addProduct(string name, uint256 price)",
  "function buyProduct(uint256 id)",
  "function products(uint256) view returns (uint256 id, string name, uint256 price, address seller, bool exists)",
  "function productCount() view returns (uint256)",
  "function buyPlan(uint8 durationDays)",
  "function logWorkout()",
  "function withdrawRewards()",
  "function getPlanInfo(address user) view returns (tuple(uint8 durationDays, uint256 pricePaid, uint256 rewardPerDay, uint256 startTimestamp, uint256 daysLogged, uint256 totalWithdrawn, bool active, bool loggedToday) info)",
  "function PLAN_21_PRICE() view returns (uint256)",
  "function PLAN_42_PRICE() view returns (uint256)",
  "function PLAN_63_PRICE() view returns (uint256)",
];

const YODA_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// Updated to reflect the YODA price request
const PLANS = [
  { days: 21, label: "Starter", emoji: "🌱", desc: "Build the habit", color: "#4ade80", price: "20" },
  { days: 42, label: "Builder", emoji: "🔥", desc: "Level up your grind", color: "#fb923c", price: "40" },
  { days: 63, label: "Elite",   emoji: "⚡", desc: "Maximum commitment", color: "#a78bfa", price: "60" },
];

export default function App() {
  const [account, setAccount]     = useState(null);
  const [balance, setBalance]     = useState("0");
  const [products, setProducts]   = useState([]);
  const [planInfo, setPlanInfo]   = useState(null);
  const [planPrices, setPlanPrices] = useState({});
  const [tab, setTab]             = useState("plans");
  const [loading, setLoading]     = useState(false);
  const [txMsg, setTxMsg]         = useState("");
  const [name, setName]           = useState("");
  const [price, setPrice]         = useState("");

  const getContracts = useCallback(async (withSigner = false) => {
    const provider = new ethers.BrowserProvider(window.ethereum);
    if (withSigner) {
      const signer = await provider.getSigner();
      return { 
        provider, 
        contract: new ethers.Contract(MARKET_ADDRESS, ABI, signer),
        yoda: new ethers.Contract(YODA_ADDRESS, YODA_ABI, signer)
      };
    }
    return { 
      provider, 
      contract: new ethers.Contract(MARKET_ADDRESS, ABI, provider),
      yoda: new ethers.Contract(YODA_ADDRESS, YODA_ABI, provider)
    };
  }, []);

  const loadData = useCallback(async (acc) => {
    try {
      const { contract, yoda } = await getContracts();
      const bal = await yoda.balanceOf(acc);
      setBalance(ethers.formatUnits(bal, YODA_DECIMALS));

      // We still fetch from contract to ensure syncing, but we fallback to our UI constants if needed
      const [p21, p42, p63] = await Promise.all([
        contract.PLAN_21_PRICE(),
        contract.PLAN_42_PRICE(),
        contract.PLAN_63_PRICE(),
      ]);

      setPlanPrices({
        21: ethers.formatUnits(p21, YODA_DECIMALS),
        42: ethers.formatUnits(p42, YODA_DECIMALS),
        63: ethers.formatUnits(p63, YODA_DECIMALS),
      });

      const info = await contract.getPlanInfo(acc);
      setPlanInfo({
        durationDays:   Number(info.durationDays),
        pricePaid:      ethers.formatUnits(info.pricePaid, YODA_DECIMALS),
        rewardPerDay:   ethers.formatUnits(info.rewardPerDay, YODA_DECIMALS),
        startTimestamp: Number(info.startTimestamp),
        daysLogged:     Number(info.daysLogged),
        totalWithdrawn: ethers.formatUnits(info.totalWithdrawn, YODA_DECIMALS),
        active:         info.active,
        loggedToday:    info.loggedToday,
        pendingReward:  (parseFloat(ethers.formatUnits(info.rewardPerDay, YODA_DECIMALS)) * Number(info.daysLogged)) - parseFloat(ethers.formatUnits(info.totalWithdrawn, YODA_DECIMALS)),
      });

      const count = await contract.productCount();
      const items = [];
      for (let i = 1; i <= Number(count); i++) {
        const p = await contract.products(i);
        if (p.exists) {
          items.push({
            id:     p.id.toString(),
            name:   p.name,
            price:  ethers.formatUnits(p.price, YODA_DECIMALS),
            seller: p.seller,
          });
        }
      }
      setProducts(items);
    } catch (e) {
      console.error("loadData error:", e);
    }
  }, [getContracts]);

  useEffect(() => {
    if (account) loadData(account);
  }, [account, loadData]);

  async function connectWallet() {
    if (!window.ethereum) return alert("Please install MetaMask");
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== SEPOLIA_CHAIN_ID) {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    }
    const [acc] = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(acc);
  }

  async function withLoading(label, fn) {
    setLoading(true);
    setTxMsg(label);
    try {
      await fn();
      setTxMsg("✅ Done!");
    } catch (e) {
      console.error(e);
      const msg = e?.reason || e?.message || "Transaction failed";
      setTxMsg("❌ " + msg.slice(0, 80));
    }
    setTimeout(() => setTxMsg(""), 4000);
    setLoading(false);
    loadData(account);
  }

  async function ensureApproval(yodaContract, amount) {
    const allowance = await yodaContract.allowance(account, MARKET_ADDRESS);
    if (allowance < amount) {
      setTxMsg("Approving YODA...");
      const tx = await yodaContract.approve(MARKET_ADDRESS, amount);
      await tx.wait();
    }
  }

  async function handleBuyPlan(days) {
    // Priority: use contract price from state, fallback to hardcoded 20/40/60
    const price = planPrices[days] || PLANS.find(p => p.days === days).price;
    
    if (!price) {
      alert("Plan price not available.");
      return;
    }

    await withLoading(`Buying ${days}-day plan...`, async () => {
      const { contract, yoda } = await getContracts(true);
      const rawPrice = ethers.parseUnits(price.toString(), YODA_DECIMALS);
      await ensureApproval(yoda, rawPrice);
      const tx = await contract.buyPlan(days);
      await tx.wait();
    });
  }

  async function handleLogWorkout() {
    await withLoading("Logging workout...", async () => {
      const { contract } = await getContracts(true);
      const tx = await contract.logWorkout();
      await tx.wait();
    });
  }

  async function handleWithdraw() {
    await withLoading("Withdrawing rewards...", async () => {
      const { contract } = await getContracts(true);
      const tx = await contract.withdrawRewards();
      await tx.wait();
    });
  }

  async function handleAddProduct() {
    if (!name || !price) return alert("Fill in product details");
    await withLoading("Listing product...", async () => {
      const { contract } = await getContracts(true);
      const tx = await contract.addProduct(name, ethers.parseUnits(price, YODA_DECIMALS));
      await tx.wait();
      setName(""); setPrice("");
    });
  }

  async function handleBuyProduct(id, priceYoda) {
    await withLoading("Buying product...", async () => {
      const { contract, yoda } = await getContracts(true);
      const rawPrice = ethers.parseUnits(priceYoda, YODA_DECIMALS);
      await ensureApproval(yoda, rawPrice);
      const tx = await contract.buyProduct(id);
      await tx.wait();
    });
  }

  const progressPct = planInfo?.active ? Math.round((planInfo.daysLogged / planInfo.durationDays) * 100) : 0;

  return (
    <>
      <style>{`
        /* [CSS REMAINS EXACTLY AS PROVIDED] */
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; color: #e8e4dc; font-family: 'Syne', sans-serif; min-height: 100vh; }
        :root { --green: #4ade80; --orange: #fb923c; --purple: #a78bfa; --red: #f87171; --dim: #6b7280; --card: #111118; --border: #1e1e2a; --mono: 'DM Mono', monospace; }
        .app { max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0 28px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
        .logo { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.5px; }
        .logo span { color: var(--green); }
        .wallet-btn { background: var(--green); color: #0a0a0f; border: none; padding: 10px 22px; border-radius: 8px; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: opacity .2s; }
        .wallet-btn:hover { opacity: .85; }
        .wallet-info { display: flex; align-items: center; gap: 14px; background: var(--card); border: 1px solid var(--border); padding: 8px 16px; border-radius: 8px; }
        .wallet-addr { font-family: var(--mono); font-size: 0.8rem; color: var(--dim); }
        .wallet-bal  { font-family: var(--mono); font-size: 0.9rem; color: var(--green); font-weight: 500; }
        .tabs { display: flex; gap: 4px; margin-bottom: 32px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 4px; width: fit-content; }
        .tab-btn { padding: 9px 22px; border-radius: 7px; border: none; cursor: pointer; font-family: 'Syne', sans-serif; font-weight: 600; font-size: 0.9rem; transition: all .2s; background: transparent; color: var(--dim); }
        .tab-btn.active { background: #1e1e2a; color: #e8e4dc; }
        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1e1e2a; border: 1px solid var(--border); padding: 12px 24px; border-radius: 10px; font-family: var(--mono); font-size: 0.85rem; z-index: 999; animation: fadeUp .3s ease; }
        @keyframes fadeUp { from { opacity:0; transform: translateX(-50%) translateY(10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
        .plan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 32px; }
        .plan-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 24px; position: relative; overflow: hidden; transition: border-color .2s, transform .2s; }
        .plan-card:hover { transform: translateY(-2px); }
        .plan-card::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at top left, var(--accent-color, #4ade8022) 0%, transparent 60%); pointer-events: none; }
        .plan-emoji { font-size: 2.4rem; margin-bottom: 10px; display: block; }
        .plan-name  { font-size: 1.2rem; font-weight: 700; margin-bottom: 4px; }
        .plan-days  { font-family: var(--mono); font-size: 0.78rem; color: var(--dim); margin-bottom: 6px; }
        .plan-desc  { font-size: 0.85rem; color: var(--dim); margin-bottom: 16px; }
        .plan-price { font-family: var(--mono); font-size: 1.1rem; font-weight: 500; margin-bottom: 16px; }
        .plan-price span { color: var(--dim); font-size: 0.8rem; }
        .plan-btn { width: 100%; padding: 11px; border-radius: 8px; border: none; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: opacity .2s; background: var(--accent-color, var(--green)); color: #0a0a0f; }
        .plan-btn:hover { opacity: .85; }
        .plan-btn:disabled { opacity: .4; cursor: not-allowed; }
        .active-plan { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 28px; margin-bottom: 28px; }
        .active-plan-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        .active-plan-title { font-size: 1.3rem; font-weight: 700; }
        .active-plan-badge { background: #4ade8022; color: var(--green); border: 1px solid #4ade8044; border-radius: 20px; padding: 4px 12px; font-size: 0.75rem; font-weight: 600; }
        .progress-bar-wrap { background: #1e1e2a; border-radius: 6px; height: 8px; margin: 12px 0 6px; overflow: hidden; }
        .progress-bar-fill { height: 100%; border-radius: 6px; background: var(--green); transition: width .4s; }
        .progress-labels { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.75rem; color: var(--dim); }
        .plan-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
        .stat-box { background: #1a1a24; border-radius: 10px; padding: 14px; text-align: center; }
        .stat-val { font-family: var(--mono); font-size: 1rem; font-weight: 500; margin-bottom: 4px; }
        .stat-label { font-size: 0.72rem; color: var(--dim); }
        .plan-actions { display: flex; gap: 10px; }
        .action-btn { flex: 1; padding: 12px; border-radius: 8px; border: none; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: opacity .2s; }
        .action-btn:disabled { opacity: .4; cursor: not-allowed; }
        .btn-log { background: var(--green);  color: #0a0a0f; }
        .btn-withdraw { background: #1e1e2a; color: #e8e4dc; border: 1px solid var(--border); }
        .btn-withdraw:hover:not(:disabled) { background: #2a2a38; }
        .logged-today-badge { text-align: center; padding: 10px; background: #4ade8011; border: 1px solid #4ade8033; border-radius: 8px; color: var(--green); font-size: 0.85rem; font-weight: 600; margin-bottom: 10px; }
        .market-add { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-bottom: 28px; }
        .market-add h3 { font-size: 1rem; font-weight: 700; margin-bottom: 16px; }
        .input-row { display: flex; gap: 10px; flex-wrap: wrap; }
        .field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 140px; }
        .field label { font-size: 0.75rem; color: var(--dim); font-weight: 600; letter-spacing: .5px; }
        .field input { background: #1a1a24; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; color: #e8e4dc; font-family: var(--mono); font-size: 0.9rem; outline: none; transition: border-color .2s; }
        .field input:focus { border-color: #3a3a50; }
        .add-btn { background: #e8e4dc; color: #0a0a0f; border: none; padding: 10px 24px; border-radius: 8px; font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.9rem; cursor: pointer; align-self: flex-end; transition: opacity .2s; white-space: nowrap; }
        .add-btn:hover { opacity: .85; }
        .add-btn:disabled { opacity: .4; cursor: not-allowed; }
        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
        .product-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; transition: border-color .2s, transform .2s; }
        .product-card:hover { border-color: #2a2a3a; transform: translateY(-2px); }
        .product-icon { font-size: 2rem; margin-bottom: 10px; }
        .product-name { font-weight: 700; margin-bottom: 6px; font-size: 0.95rem; }
        .product-price { font-family: var(--mono); color: var(--green); font-size: 1rem; font-weight: 500; margin-bottom: 6px; }
        .product-seller { font-family: var(--mono); font-size: 0.68rem; color: var(--dim); margin-bottom: 14px; }
        .buy-btn { width: 100%; padding: 10px; border-radius: 7px; border: none; background: #1e1e2a; color: #e8e4dc; border: 1px solid var(--border); font-family: 'Syne', sans-serif; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: background .2s; }
        .buy-btn:hover:not(:disabled) { background: #2a2a3a; }
        .buy-btn:disabled { opacity: .4; cursor: not-allowed; }
        .empty { text-align: center; color: var(--dim); padding: 48px; font-size: 0.9rem; }
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 18px; }
        .connect-cta { text-align: center; padding: 80px 20px; }
        .connect-cta h2 { font-size: 2rem; font-weight: 800; margin-bottom: 12px; }
        .connect-cta p { color: var(--dim); margin-bottom: 28px; }
      `}</style>

      <div className="app">
        <header className="header">
          <div className="logo">FIT<span>COIN</span></div>
          {!account ? (
            <button className="wallet-btn" onClick={connectWallet}>Connect Wallet</button>
          ) : (
            <div className="wallet-info">
              <span className="wallet-addr">{account.slice(0,6)}…{account.slice(-4)}</span>
              <span className="wallet-bal">{balance} YODA</span>
            </div>
          )}
        </header>

        {!account ? (
          <div className="connect-cta">
            <h2>Stake your commitment.<br />Earn it back daily.</h2>
            <p>Buy a fitness plan, log one workout per day, get your YODA back.</p>
            <button className="wallet-btn" onClick={connectWallet}>Connect MetaMask</button>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button className={`tab-btn ${tab === "plans" ? "active" : ""}`} onClick={() => setTab("plans")}>
                🏋️ Fitness Plans
              </button>
              <button className={`tab-btn ${tab === "market" ? "active" : ""}`} onClick={() => setTab("market")}>
                🛒 Marketplace
              </button>
            </div>

            {tab === "plans" && (
              <>
                {planInfo?.active ? (
                  <div className="active-plan">
                    <div className="active-plan-header">
                      <div>
                        <div className="active-plan-title">
                          {PLANS.find(p => p.days === planInfo.durationDays)?.emoji}{" "}
                          {planInfo.durationDays}-Day{" "}
                          {PLANS.find(p => p.days === planInfo.durationDays)?.label} Plan
                        </div>
                        <div style={{ color: "var(--dim)", fontSize: "0.8rem", marginTop: 4, fontFamily: "var(--mono)" }}>
                          {planInfo.rewardPerDay} YODA / workout
                        </div>
                      </div>
                      <span className="active-plan-badge">ACTIVE</span>
                    </div>

                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="progress-labels">
                      <span>Day {planInfo.daysLogged} of {planInfo.durationDays}</span>
                      <span>{progressPct}% complete</span>
                    </div>

                    <div className="plan-stats">
                      <div className="stat-box">
                        <div className="stat-val" style={{ color: "var(--green)" }}>
                          {planInfo.pricePaid} YODA
                        </div>
                        <div className="stat-label">Total Staked</div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-val" style={{ color: "var(--orange)" }}>
                          {(parseFloat(planInfo.rewardPerDay) * planInfo.daysLogged).toFixed(2)} YODA
                        </div>
                        <div className="stat-label">Total Earned</div>
                      </div>
                      <div className="stat-box">
                        <div className="stat-val" style={{ color: "var(--purple)" }}>
                          {planInfo.pendingReward > 0 ? planInfo.pendingReward.toFixed(2) : "0"} YODA
                        </div>
                        <div className="stat-label">Pending</div>
                      </div>
                    </div>

                    {planInfo.loggedToday && (
                      <div className="logged-today-badge">✅ Workout logged today — come back tomorrow!</div>
                    )}

                    <div className="plan-actions">
                      <button
                        className="action-btn btn-log"
                        disabled={loading || planInfo.loggedToday}
                        onClick={handleLogWorkout}
                      >
                        {planInfo.loggedToday ? "Logged Today ✓" : "Log Workout 💪"}
                      </button>
                      <button
                        className="action-btn btn-withdraw"
                        disabled={loading || planInfo.pendingReward <= 0}
                        onClick={handleWithdraw}
                      >
                        Withdraw {planInfo.pendingReward > 0 ? planInfo.pendingReward.toFixed(2) : "0"} YODA
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="section-title">Choose your commitment</p>
                    <div className="plan-grid">
                      {PLANS.map(plan => {
                        const displayPrice = planPrices[plan.days] || plan.price;
                        return (
                          <div
                            key={plan.days}
                            className="plan-card"
                            style={{ "--accent-color": plan.color, borderColor: plan.color + "33" }}
                          >
                            <span className="plan-emoji">{plan.emoji}</span>
                            <div className="plan-name">{plan.label}</div>
                            <div className="plan-days">{plan.days} DAYS</div>
                            <div className="plan-desc">{plan.desc}</div>
                            <div className="plan-price">
                              {displayPrice} YODA{" "}
                              <span>({(parseFloat(displayPrice) / plan.days).toFixed(2)} YODA/day back)</span>
                            </div>
                            <button
                              className="plan-btn"
                              style={{ background: plan.color }}
                              disabled={loading}
                              onClick={() => handleBuyPlan(plan.days)}
                            >
                              Start Plan
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "market" && (
              <>
                <div className="market-add">
                  <h3>List a Product</h3>
                  <div className="input-row">
                    <div className="field">
                      <label>ITEM NAME</label>
                      <input
                        placeholder="e.g. Resistance Band Set"
                        value={name}
                        onChange={e => setName(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>PRICE (YODA)</label>
                      <input
                        type="number"
                        placeholder="100.00"
                        step="1"
                        min="0"
                        value={price}
                        onChange={e => setPrice(e.target.value)}
                      />
                    </div>
                    <button className="add-btn" disabled={loading} onClick={handleAddProduct}>
                      List Item
                    </button>
                  </div>
                </div>

                <p className="section-title">Available Items ({products.length})</p>
                {products.length === 0 ? (
                  <div className="empty">No products listed yet. Be the first!</div>
                ) : (
                  <div className="product-grid">
                    {products.map(p => (
                      <div key={p.id} className="product-card">
                        <div className="product-icon">📦</div>
                        <div className="product-name">{p.name}</div>
                        <div className="product-price">{parseFloat(p.price).toFixed(2)} YODA</div>
                        <div className="product-seller">
                          {p.seller.slice(0, 6)}…{p.seller.slice(-4)}
                        </div>
                        <button
                          className="buy-btn"
                          disabled={loading || p.seller.toLowerCase() === account?.toLowerCase()}
                          onClick={() => handleBuyProduct(p.id, p.price)}
                        >
                          {p.seller.toLowerCase() === account?.toLowerCase() ? "Your listing" : "Buy Now →"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {txMsg && <div className="toast">{txMsg}</div>}
    </>
  );
}