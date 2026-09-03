/* ═══════════════════════════════════════════════════════════════════════════
   ReSell — Application Logic & Client-Side Database Engine
   ───────────────────────────────────────────────────────────────────────────
   Loaded as a CLASSIC script from the end of <body> in index.html:
       <script src="app.js"></script>

   Classic (not type="module") is deliberate: every top-level `function` here
   becomes a global, which is what the inline onclick="..." handlers all over
   index.html need. Do NOT add `type="module"` to the tag — doing so scopes
   these declarations to the module and every inline handler breaks with
   "X is not defined". The Firebase SDK (which is ESM-only) is pulled in with
   a dynamic import() at the bottom of this file instead.

   Layout of this file:
     1. Storage layer .............. window.DB (localStorage wrapper)
     2. Clean default state ........ first-run / signed-out seed data
     3. Catalog constants .......... BRANDS, BOM_BASE, COND_MULT, STORE_ITEMS
     4. Navigation & chrome ........ nav / modals / toast
     5. Profile & database UI ...... renderDatabaseUI + record removal
     6. Sell flow .................. valuation, disassembly, trend chart
     7. Vision scan ................ mock computer-vision estimator
     8. Storefront ................. filters, PDP, cart, checkout
     9. AI advisor ................. chat log + response generator
    10. Pickup / location / avatar
    11. Motion & scroll effects .... counters, confetti, reveal, dot rail
    12. Firebase auth bootstrap .... dynamic import, runs last
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 1. Storage layer ───────────────────────────────────────────────────── */
window.DB = {
  get: (k, def) => {
    try {
      const v = localStorage.getItem('resell_db_' + k);
      return v ? JSON.parse(v) : def;
    } catch(e) { return def; }
  },
  set: (k, v) => {
    try {
      localStorage.setItem('resell_db_' + k, JSON.stringify(v));
    } catch(e) {}
  }
};

// CLEAN DEFAULT STATE

/* ── 2. Clean default state & session seed ─────────────────────────────── */

window.setCleanDefaultState = function() {
  window.DB.set('user', { 
    name: 'Guest User', 
    email: 'guest@resell.com', 
    city: 'Bhatpara, WB', 
    photoURL: '', 
    isLoggedIn: false 
  });
  window.DB.set('quotes', []);
  window.DB.set('orders', []);
  window.DB.set('addresses', []);
  renderDatabaseUI();
};

const S = {
  page: 'home',
  mode: 'seller',
  cartItems: [],
  pdpId: 3,                 // matches the PDP's static markup until openPDP() runs
  currentQuotedModel: '',
  chartInst: null,
  tearingDown: false,       // guards runDisassembly() while the separation plays
  // Per-component condition answers, keyed by GRADE_GROUPS[].key. Seeded from
  // the first (best) option of each group by resetSellAndDisassembleToDefault.
  grades: {}
};
// ─── RESET SELL & DISASSEMBLE TO CLEAN DEFAULT ───
function resetSellAndDisassembleToDefault() {
  // Reassemble the phone: no .exploded.
  const phone = document.getElementById('phone-explode');
  if (phone) phone.classList.remove('exploded');
  if (Teardown3D.ready) Teardown3D.assemble();
  const hint = document.getElementById('explode-hint');
  if (hint) hint.textContent = 'Grade the components, then run the teardown to separate and price every part.';

  // Reset status badge
  const disBadge = document.getElementById('dis-badge');
  if (disBadge) {
    disBadge.textContent = 'Ready to Analyze';
    disBadge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600';
  }

  // Part labels go back to zero; they only carry figures once a teardown runs.
  EXPLODE_PARTS.forEach(([, key]) => setPartValue(key, '₹0'));

  const bomAgeLabel = document.getElementById('bom-age-label');
  if (bomAgeLabel) bomAgeLabel.textContent = 'Estimate only — run the teardown to lock this quote';

  // Grading answers go back to mint, which is what the pricing window prices.
  S.tearingDown = false;
  S.grades = defaultGrades();
  renderGradeCards();
  refreshGradeEstimate();

  // Render neutral initial chart
  renderTrendChartRealistic('realme', 0.60, 36);
}

// ─── FIREBASE AUTH HANDLERS ───
window.triggerFirebaseGoogleLogin = async () => {
  if (window.FirebaseAuth) {
    try {
      await window.FirebaseAuth.signInWithGoogle();
    } catch (e) {
      console.warn("Using local auth profile fallback");
    }
  } else {
    promptLocalAuth();
  }
};

window.triggerFirebaseSignOut = async () => {
  if (window.FirebaseAuth) {
    await window.FirebaseAuth.signOutUser();
  } else {
    window.handleFirebaseUserLogout();
  }
};

window.handleFirebaseUserLogin = (user) => {
  const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Gourab Das');
  const email = user.email || 'user@gmail.com';
  const photo = user.photoURL || '';

  window.DB.set('user', { name, email, city: 'Bhatpara, WB', photoURL: photo, isLoggedIn: true });
  
  document.getElementById('auth-label').textContent = name.split(' ')[0];
  if (photo) {
    const navImg = document.getElementById('nav-user-photo');
    navImg.src = photo;
    navImg.classList.remove('hidden');
    document.getElementById('nav-google-icon').classList.add('hidden');
    
    const profImg = document.getElementById('prof-avatar-img');
    profImg.src = photo;
    profImg.classList.remove('hidden');
    document.getElementById('prof-avatar-icon').classList.add('hidden');
  }

  renderDatabaseUI();
  toast(`✓ Authenticated via Firebase: ${name}`);
};

window.handleFirebaseUserLogout = () => {
  window.setCleanDefaultState();
  document.getElementById('auth-label').textContent = 'Sign in with Google';
  document.getElementById('nav-user-photo').classList.add('hidden');
  document.getElementById('nav-google-icon').classList.remove('hidden');
  document.getElementById('prof-avatar-img').classList.add('hidden');
  document.getElementById('prof-avatar-icon').classList.remove('hidden');
  resetSellAndDisassembleToDefault();
  toast('Signed out. Defaults restored.');
};

window.handleFirebaseAuthFallback = (err) => {
  console.log("Firebase popup domain note:", err.message);
  const manualName = prompt("Firebase Auth Notice (Authorized Domain): Enter your name to authenticate session locally:", "Gourab Das");
  if (manualName) {
    const mockUser = {
      displayName: manualName,
      email: manualName.toLowerCase().replace(/ /g, '.') + "@gmail.com",
      photoURL: ""
    };
    window.handleFirebaseUserLogin(mockUser);
  }
};

function promptLocalAuth() {
  const n = prompt("Enter your Name for Google Login:", "Gourab Das");
  if (n) {
    window.handleFirebaseUserLogin({ displayName: n, email: n.toLowerCase().replace(/ /g, '.') + "@gmail.com", photoURL: "" });
  }
}

// ─── 75+ PHONE CATALOG ───

/* ── 3. Catalog constants: brands, BOM, condition multipliers, storefront  */

const BRANDS = {
  realme: [
    'Realme Narzo 60 (128GB)', 'Realme 12 Pro+ (256GB)', 'Realme 11 Pro+ (256GB)', 'Realme 10 Pro+ (128GB)',
    'Realme 9 Pro+ (128GB)', 'Realme 8 Pro (128GB)', 'Realme 7 Pro (128GB)', 'Realme 6 Pro (128GB)',
    'Realme GT 5 Pro (256GB)', 'Realme GT Neo 3 (256GB)', 'Realme C55 (128GB)', 'Realme 1 (2018 Legacy)'
  ],
  apple: [
    'iPhone 15 Pro (128GB)', 'iPhone 15 (128GB)', 'iPhone 14 Pro Max (256GB)', 'iPhone 14 (128GB)',
    'iPhone 13 Pro (256GB)', 'iPhone 13 (128GB)', 'iPhone 12 (64GB)', 'iPhone 11 (64GB)',
    'iPhone XS Max (256GB)', 'iPhone X (256GB)', 'iPhone 8 (64GB)', 'iPhone 7 (32GB)',
    'iPhone 6s (32GB)', 'iPhone 6 (16GB) [2014 Vintage]', 'iPhone 5s (16GB) [2013 Legacy]', 'iPhone 4S (8GB) [2011 Vintage]'
  ],
  samsung: [
    'Galaxy S24 Ultra (256GB)', 'Galaxy S23+ (256GB)', 'Galaxy S23 (128GB)', 'Galaxy S22 Ultra (256GB)',
    'Galaxy S21 FE (128GB)', 'Galaxy S20 (128GB)', 'Galaxy S10+ (128GB)', 'Galaxy S10 (128GB)',
    'Galaxy S9 (128GB)', 'Galaxy S8 (64GB)', 'Galaxy S7 Edge (32GB)', 'Galaxy S6 (32GB) [2015 Legacy]',
    'Galaxy S5 (16GB) [2014 Legacy]', 'Galaxy S4 (16GB) [2013 Vintage]', 'Galaxy S2 (16GB) [2011 Vintage]'
  ],
  google: [
    'Pixel 8 Pro (128GB)', 'Pixel 8 (128GB)', 'Pixel 7a (128GB)', 'Pixel 7 Pro (128GB)',
    'Pixel 6 (128GB)', 'Pixel 5 (128GB)', 'Pixel 4a (128GB)', 'Pixel 3 (64GB) [Vintage]',
    'Pixel 2 XL (128GB) [Legacy]', 'Pixel (2016 Original)', 'Nexus 6P [2015 Legacy]', 'Nexus 5 (16GB) [2013 Legacy]'
  ],
  oneplus: [
    'OnePlus 12 (256GB)', 'OnePlus 11 5G (128GB)', 'OnePlus 10T 5G (128GB)', 'OnePlus 9 Pro (128GB)',
    'OnePlus 8T (128GB)', 'OnePlus 7T (128GB)', 'OnePlus 6T (128GB)', 'OnePlus 5T (64GB) [Vintage]',
    'OnePlus 3T (64GB) [Legacy]', 'OnePlus One (64GB) [2014 Flagship Killer]'
  ],
  xiaomi: [
    'Xiaomi 14 Ultra (256GB)', 'Xiaomi 13 Pro (256GB)', 'Redmi Note 13 Pro (128GB)', 'Redmi Note 12 Pro (128GB)',
    'POCO F5 (128GB)', 'POCO X5 Pro (256GB)', 'Redmi Note 8 Pro (64GB)', 'Redmi Note 4 [2016 Vintage]', 'Mi 3 [2014 Legacy]'
  ],
  oppo: [
    'OPPO Find X7 Ultra', 'OPPO Reno 11 Pro (256GB)', 'OPPO Reno 10 Pro (256GB)', 'OPPO F23 (128GB)', 'OPPO F17 Pro (128GB)', 'OPPO Find 7 [2014 Legacy]'
  ],
  vivo: [
    'Vivo X100 Pro (256GB)', 'Vivo V29 Pro (256GB)', 'iQOO 12 (256GB)', 'Vivo V27 Pro (128GB)', 'Vivo Y21 (64GB)', 'Vivo X5 Max [2014 Legacy]'
  ],
  motorola: [
    'Moto Edge 40 Pro (256GB)', 'Moto G84 (256GB)', 'Moto G73 (128GB)', 'Moto G54 (128GB)', 'Moto G1 [2013 Legacy]', 'Moto X (2013 Original)'
  ],
  nothing: [
    'Nothing Phone (2) (256GB)', 'Nothing Phone (2a) (128GB)', 'Nothing Phone (1) (128GB)'
  ],
  nokia: [
    'Nokia X30 (128GB)', 'Nokia G60 (128GB)', 'Nokia Lumia 1020 [41MP 2013 Vintage]', 'Nokia N9 [2011 Collector]'
  ]
};

const BOM_BASE = {
  realme: { display: 4800, logic: 7800, camera: 3600, battery: 1500, chassis: 900, decay: 0.024 },
  apple: { display: 7200, logic: 11500, camera: 4800, battery: 1850, chassis: 1200, decay: 0.022 },
  samsung: { display: 8100, logic: 12200, camera: 5900, battery: 2100, chassis: 1400, decay: 0.020 },
  google: { display: 8800, logic: 13200, camera: 6900, battery: 2000, chassis: 1400, decay: 0.021 },
  oneplus: { display: 7600, logic: 11900, camera: 5400, battery: 2100, chassis: 1300, decay: 0.023 },
  xiaomi: { display: 5800, logic: 9200, camera: 4200, battery: 1700, chassis: 1000, decay: 0.025 },
  oppo: { display: 5200, logic: 8400, camera: 3900, battery: 1600, chassis: 950, decay: 0.025 },
  vivo: { display: 4900, logic: 7600, camera: 3700, battery: 1500, chassis: 900, decay: 0.026 },
  motorola: { display: 4200, logic: 6800, camera: 3200, battery: 1400, chassis: 800, decay: 0.024 },
  nothing: { display: 6200, logic: 9800, camera: 4400, battery: 1800, chassis: 1100, decay: 0.023 },
  nokia: { display: 3800, logic: 5900, camera: 2800, battery: 1200, chassis: 700, decay: 0.025 }
};

const COND_MULT = { flawless: 1.0, good: 0.85, cracked: 0.60, dead: 0.25 };

// Store Catalog
const STORE_ITEMS = [
  { id: 1, type: 'dev', brand: 'apple', series: 'flagship', title: 'iPhone 15 Pro (128GB)', sub: 'Natural Titanium · Batt 98%', grade: 'A+', price: 84999, orig: 119900, icon: 'fa-brands fa-apple' },
  { id: 2, type: 'dev', brand: 'apple', series: 'flagship', title: 'iPhone 14 Pro Max (256GB)', sub: 'Space Black · Batt 94%', grade: 'A+', price: 69999, orig: 99900, icon: 'fa-brands fa-apple' },
  { id: 3, type: 'dev', brand: 'apple', series: 'midrange', title: 'iPhone 13 (128GB)', sub: 'Midnight · Batt 93%', grade: 'A+', price: 29499, orig: 38000, icon: 'fa-brands fa-apple' },
  { id: 4, type: 'dev', brand: 'apple', series: 'midrange', title: 'iPhone 11 (64GB)', sub: 'Black · Batt 87%', grade: 'A', price: 16499, orig: 24000, icon: 'fa-brands fa-apple' },
  { id: 5, type: 'dev', brand: 'apple', series: 'vintage', title: 'iPhone 6 (16GB) [2014 Vintage]', sub: 'Silver · Collector OEM', grade: 'B+', price: 4999, orig: 9000, icon: 'fa-brands fa-apple' },

  { id: 6, type: 'dev', brand: 'samsung', series: 'flagship', title: 'Galaxy S24 Ultra (256GB)', sub: 'Titanium Gray · Batt 99%', grade: 'A+', price: 79999, orig: 109999, icon: 'fa-solid fa-mobile-screen' },
  { id: 7, type: 'dev', brand: 'samsung', series: 'flagship', title: 'Galaxy S23+ (256GB)', sub: 'Phantom Black · Batt 95%', grade: 'A+', price: 42999, orig: 56000, icon: 'fa-solid fa-mobile-screen' },
  { id: 8, type: 'dev', brand: 'samsung', series: 'midrange', title: 'Galaxy S21 FE (128GB)', sub: 'Graphite · Batt 91%', grade: 'A', price: 22999, orig: 31000, icon: 'fa-solid fa-mobile-screen' },
  { id: 9, type: 'dev', brand: 'samsung', series: 'vintage', title: 'Galaxy S5 (16GB) [2014 Legacy]', sub: 'Charcoal Black · 2014 Classic', grade: 'B', price: 3999, orig: 9000, icon: 'fa-solid fa-mobile-screen' },

  { id: 10, type: 'dev', brand: 'google', series: 'flagship', title: 'Pixel 8 Pro (128GB)', sub: 'Obsidian · Batt 92%', grade: 'A+', price: 38499, orig: 52000, icon: 'fa-brands fa-google' },
  { id: 11, type: 'dev', brand: 'google', series: 'midrange', title: 'Pixel 7a (128GB)', sub: 'Sea · Batt 91%', grade: 'A', price: 24999, orig: 34000, icon: 'fa-brands fa-google' },
  { id: 12, type: 'dev', brand: 'google', series: 'vintage', title: 'Nexus 5 (16GB) [2013 Legacy]', sub: 'Black · Android Pioneer', grade: 'B', price: 2999, orig: 7000, icon: 'fa-brands fa-google' },

  { id: 13, type: 'dev', brand: 'oneplus', series: 'flagship', title: 'OnePlus 12 (256GB)', sub: 'Silky Black · Batt 97%', grade: 'A+', price: 44999, orig: 64999, icon: 'fa-solid fa-mobile' },
  { id: 14, type: 'dev', brand: 'oneplus', series: 'midrange', title: 'OnePlus 11 5G (128GB)', sub: 'Titan Black · Batt 91%', grade: 'A', price: 27999, orig: 36000, icon: 'fa-solid fa-mobile' },
  { id: 15, type: 'dev', brand: 'oneplus', series: 'vintage', title: 'OnePlus One (64GB) [2014 Legacy]', sub: 'Sandstone Black · 2014', grade: 'B', price: 2499, orig: 7000, icon: 'fa-solid fa-mobile' },

  { id: 16, type: 'dev', brand: 'realme', series: 'midrange', title: 'Realme Narzo 60 (128GB)', sub: 'Mars Orange · Batt 93%', grade: 'A', price: 11999, orig: 17999, icon: 'fa-solid fa-mobile' },
  { id: 17, type: 'dev', brand: 'realme', series: 'midrange', title: 'Realme 11 Pro+ (256GB)', sub: 'Sunrise Beige · Batt 94%', grade: 'A', price: 23999, orig: 31000, icon: 'fa-solid fa-mobile' },

  // Harvested OEM Parts
  { id: 101, type: 'parts', brand: 'apple', series: 'parts', title: 'iPhone 13 OLED Display Panel', sub: '6.1" Super Retina · Tested', grade: 'OEM', price: 7200, orig: 11500, icon: 'fa-solid fa-desktop' },
  { id: 102, type: 'parts', brand: 'apple', series: 'parts', title: 'A15 Bionic Logic Board (128GB)', sub: 'Chip-tested · Clean', grade: 'OEM', price: 11500, orig: 16000, icon: 'fa-solid fa-microchip' },
  { id: 103, type: 'parts', brand: 'samsung', series: 'parts', title: 'Galaxy S23 Triple Camera Array', sub: 'OIS Stabilizer Tested', grade: 'OEM', price: 5900, orig: 9000, icon: 'fa-solid fa-camera' },
  { id: 104, type: 'parts', brand: 'realme', series: 'parts', title: 'Realme Narzo 60 5000mAh Battery', sub: 'Health >90% Tested', grade: 'OEM', price: 1500, orig: 2800, icon: 'fa-solid fa-car-battery' }
];


/* ── 4. Navigation, modals & toast ─────────────────────────────────────── */

function nav(p) {
  S.page = p;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const target = document.getElementById('view-' + p);
  if (target) setTimeout(() => target.classList.add('on'), 10);

  const highlight = (p === 'pdp') ? 'shop' : p;
  document.querySelectorAll('.nav-link, .mob-nav').forEach(b => {
    b.classList.toggle('active', b.dataset.p === highlight);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const rail = document.getElementById('sec-rail');
  if (rail) rail.classList.toggle('on', p === 'home');

  if (p === 'shop') renderShop('dev', 'all');
  if (p === 'quote') setTimeout(updateModels, 50);
  if (p === 'profile') renderDatabaseUI();
  if (window.watchAnimatedDecor) setTimeout(window.watchAnimatedDecor, 60);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ─── ACCOUNT DATABASE UI ───

/* ── 5. Profile & database-backed UI ───────────────────────────────────── */

function renderDatabaseUI() {
  const user = window.DB.get('user', { name: 'Guest User', email: 'guest@resell.com', city: 'Bhatpara, WB', photoURL: '', isLoggedIn: false });
  const quotes = window.DB.get('quotes', []);
  const orders = window.DB.get('orders', []);
  const addrs = window.DB.get('addresses', []);

  document.getElementById('prof-name').textContent = user.name;
  document.getElementById('prof-email').textContent = user.isLoggedIn 
    ? `${user.email} · Connected to Firebase Project resell-123`
    : 'Sign in with Google to sync active quotations, orders, and addresses.';
  
  document.getElementById('prof-status-badge').textContent = user.isLoggedIn ? 'Firebase Verified Member' : 'Guest Account';
  document.getElementById('auth-label').textContent = user.isLoggedIn ? user.name.split(' ')[0] : 'Sign in with Google';
  
  if (user.isLoggedIn) {
    document.getElementById('prof-signout-btn').classList.remove('hidden');
  } else {
    document.getElementById('prof-signout-btn').classList.add('hidden');
  }

  // Active Quotes
  document.getElementById('active-q-count').textContent = quotes.length + ' Active';
  const totalQuoteVal = quotes.reduce((a, b) => a + b.price, 0);
  document.getElementById('seller-quotes-total-txt').textContent = 'Total ₹' + totalQuoteVal.toLocaleString('en-IN');

  const qList = document.getElementById('seller-quotes-list');
  if (quotes.length === 0) {
    qList.innerHTML = '<div class="p-6 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-400 text-xs font-semibold">No active quotations yet. Value a smartphone to lock in your price.</div>';
    document.getElementById('home-saved-quote-title').textContent = 'No Active Quote';
    document.getElementById('home-saved-quote-price').textContent = 'Value a phone to lock price';
  } else {
    qList.innerHTML = quotes.map(q => `
      <div id="quote-card-${q.id}" class="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xl text-[#284139] flex-shrink-0">
            <i class="fa-solid fa-mobile"></i>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-sm text-slate-900">${q.title}</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">${q.status}</span>
            </div>
            <p class="text-xs text-slate-500">Condition: ${q.condition} · Hub: ${q.hub}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div class="text-right">
            <p class="text-xs text-slate-400">Offer Amount</p>
            <p class="text-xl font-black text-[#284139]">₹${q.price.toLocaleString('en-IN')}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="openModal('pickup-modal')" class="px-3.5 py-2.5 rounded-xl bg-[#A85B28] hover:bg-[#8A4A20] text-white font-bold text-xs">Schedule Pickup</button>
            <button onclick="removeQuoteFromDB('${q.id}')" class="px-2.5 py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      </div>
    `).join('');
    
    document.getElementById('home-saved-quote-title').textContent = quotes[0].title;
    document.getElementById('home-saved-quote-price').textContent = `₹${quotes[0].price.toLocaleString('en-IN')} Locked`;
  }

  // Active Orders
  document.getElementById('orders-count').textContent = orders.length + ' Active';
  const oList = document.getElementById('buyer-orders-list');
  if (orders.length === 0) {
    oList.innerHTML = '<div class="p-6 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-400 text-xs font-semibold">No purchased devices found. Visit the storefront to explore certified devices.</div>';
    document.getElementById('last-order-txt').textContent = 'No Orders Yet';
  } else {
    oList.innerHTML = orders.map(o => `
      <div id="order-card-${o.id}" class="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xl text-[#A85B28] flex-shrink-0">
            <i class="fa-solid fa-shield-heart"></i>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-sm text-slate-900">${o.title}</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">1-Yr Warranty Active</span>
            </div>
            <p class="text-xs text-slate-500">Order #${o.id} · Certified by Nexgen</p>
            <p class="text-xs text-[#A85B28] font-semibold">${o.warrantyDays} Days Remaining on Guarantee</p>
          </div>
        </div>
        <div class="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          <button onclick="openModal('track-modal')" class="px-3.5 py-2.5 rounded-xl bg-[#284139] text-white font-bold text-xs">Track</button>
          <button onclick="removeOrderFromDB('${o.id}')" class="px-2.5 py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');
    document.getElementById('last-order-txt').textContent = orders[0].title;
  }

  // Addresses
  const aList = document.getElementById('address-list');
  if (addrs.length === 0) {
    aList.innerHTML = '<div class="p-4 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-400 text-xs font-semibold">No saved addresses. Click "+ Add Address" to create one.</div>';
  } else {
    aList.innerHTML = addrs.map(a => `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
        <div><p class="font-bold text-slate-900">${a.label}</p><p class="text-slate-500">${a.text}</p></div>
        <div class="flex gap-2">
          <button onclick="removeAddressFromDB('${a.id}')" class="text-rose-500 hover:underline font-bold">Remove</button>
        </div>
      </div>
    `).join('');
  }
}

function removeQuoteFromDB(id) {
  let quotes = window.DB.get('quotes', []);
  quotes = quotes.filter(q => q.id !== id);
  window.DB.set('quotes', quotes);
  renderDatabaseUI();
  toast('Quote removed from database');
}

function removeOrderFromDB(id) {
  let orders = window.DB.get('orders', []);
  orders = orders.filter(o => o.id !== id);
  window.DB.set('orders', orders);
  renderDatabaseUI();
  toast('Order record removed from database');
}

function removeAddressFromDB(id) {
  let addrs = window.DB.get('addresses', []);
  addrs = addrs.filter(a => a.id !== id);
  window.DB.set('addresses', addrs);
  renderDatabaseUI();
  toast('Address removed from database');
}

function addNewAddressPrompt() {
  const txt = prompt('Enter your full delivery/pickup address:');
  if (!txt) return;
  const addrs = window.DB.get('addresses', []);
  addrs.push({ id: 'addr-' + Date.now(), label: 'Saved Address', text: txt });
  window.DB.set('addresses', addrs);
  renderDatabaseUI();
  toast('Address saved to database!');
}


/* ── 6. Sell flow: mode, models, valuation & disassembly ───────────────── */

function setMode(m) {
  S.mode = m;
  document.getElementById('mode-seller').classList.toggle('active', m === 'seller');
  document.getElementById('mode-buyer').classList.toggle('active', m === 'buyer');
  document.getElementById('seller-view').classList.toggle('hidden', m !== 'seller');
  document.getElementById('buyer-view').classList.toggle('hidden', m !== 'buyer');
}

function updateModels() {
  const brand = document.getElementById('sel-brand').value;
  const sel = document.getElementById('sel-model');
  sel.innerHTML = '<option value="" disabled selected>(Choose Model)</option>';
  if (brand && BRANDS[brand]) {
    BRANDS[brand].forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      sel.appendChild(o);
    });
  }
}

/* ── 6a. Component grading ───────────────────────────────────────────────
   One group per BOM part, so a grade the seller can actually observe maps
   straight onto the line item it discounts. `mult` scales that part's aged
   value; `weight` is the part's share of the 0-100 condition score shown in
   the live panel (weights sum to 1). Options run best → worst and the first
   is the default, which is what makes an untouched form read as mint.
   Rendered by renderGradeCards(), priced by computeQuote(). */
const GRADE_GROUPS = [
  {
    key: 'display', part: 'display', weight: 0.30,
    icon: 'fa-mobile-screen', title: 'Display', sub: 'How does the screen look?',
    options: [
      { v: 'flawless', label: 'Flawless',        desc: 'No marks at any angle',           mult: 1.00, tag: '100% tested' },
      { v: 'light',    label: 'Light scratches', desc: 'Visible off, invisible in use',   mult: 0.88, tag: 'Light scratches' },
      { v: 'deep',     label: 'Deep scratches',  desc: 'Catch a fingernail',              mult: 0.68, tag: 'Deep scratches' },
      { v: 'cracked',  label: 'Cracked',         desc: 'Glass broken or lifting',         mult: 0.35, tag: 'Digitizer cracked' },
      { v: 'burn',     label: 'Dead / burn-in',  desc: 'Dead pixels, lines or ghosting',  mult: 0.15, tag: 'Panel faulty' }
    ]
  },
  {
    key: 'frame', part: 'chassis', weight: 0.15,
    icon: 'fa-layer-group', title: 'Frame &amp; back', sub: 'What about the housing?',
    options: [
      { v: 'mint',    label: 'Mint',         desc: 'Looks unused',               mult: 1.00 },
      { v: 'scuffs',  label: 'Minor scuffs', desc: 'Small edge wear',            mult: 0.86 },
      { v: 'dents',   label: 'Dents',        desc: 'Noticeable bends or gouges', mult: 0.62 },
      { v: 'cracked', label: 'Cracked back', desc: 'Rear glass damaged',         mult: 0.40 }
    ]
  },
  {
    key: 'battery', part: 'battery', weight: 0.20,
    icon: 'fa-car-battery', title: 'Battery', sub: 'What is the health reading?',
    options: [
      { v: 'high',    label: '90% or above',     desc: 'Effectively as-new capacity',   mult: 1.00, tag: 'Health 90%+' },
      { v: 'mid',     label: '80 to 89%',        desc: 'Normal for age',                mult: 0.80, tag: 'Health 80-89%' },
      { v: 'low',     label: 'Below 80%',        desc: 'Noticeably shorter runtime',    mult: 0.52, tag: 'Health under 80%' },
      { v: 'service', label: 'Service required', desc: 'Swelling or sudden shutdowns',  mult: 0.20, tag: 'Service required' }
    ]
  },
  {
    key: 'camera', part: 'camera', weight: 0.15,
    icon: 'fa-camera', title: 'Cameras', sub: 'Do all the lenses shoot cleanly?',
    options: [
      { v: 'clean',   label: 'All clean',       desc: 'Sharp on every lens',      mult: 1.00 },
      { v: 'dust',    label: 'Dust or specks',  desc: 'Visible in bright shots',  mult: 0.82 },
      { v: 'onefail', label: 'One lens faulty', desc: 'Blurry, shaky or dead',    mult: 0.55 },
      { v: 'broken',  label: 'Glass cracked',   desc: 'Rear camera glass broken', mult: 0.30 }
    ]
  },
  {
    key: 'logic', part: 'logic', weight: 0.20,
    icon: 'fa-microchip', title: 'Board &amp; sensors', sub: 'How does it behave once it is on?',
    options: [
      { v: 'ok',       label: 'Boots normally',      desc: 'Every sensor responds',     mult: 1.00 },
      { v: 'minor',    label: 'Minor faults',        desc: 'Face unlock or mic issues', mult: 0.78 },
      { v: 'unstable', label: 'Restarts or freezes', desc: 'Unstable under load',       mult: 0.50 },
      { v: 'dead',     label: 'Will not power on',   desc: 'No boot, no charge',        mult: 0.18 }
    ]
  }
];

/* Score bands. `cond` folds the 0-100 score back onto the four coarse
   conditions the quote records and the teardown copy already speak. */
const GRADE_BANDS = [
  { min: 97, label: 'Mint',      cond: 'flawless', ring: '#F8D794' },
  { min: 85, label: 'Excellent', cond: 'flawless', ring: '#CFB98C' },
  { min: 70, label: 'Good',      cond: 'good',     ring: '#809076' },
  { min: 50, label: 'Fair',      cond: 'cracked',  ring: '#E5A876' },
  { min: 0,  label: 'Salvage',   cond: 'dead',     ring: '#D2874C' }
];

const defaultGrades = () =>
  GRADE_GROUPS.reduce((acc, g) => { acc[g.key] = g.options[0].v; return acc; }, {});

const gradeOption = (g) => g.options.find(o => o.v === S.grades[g.key]) || g.options[0];

function renderGradeCards() {
  const host = document.getElementById('grade-cards');
  if (!host) return;
  host.innerHTML = GRADE_GROUPS.map((g, gi) => `
    <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
      <div class="flex items-start gap-3 mb-4">
        <span class="w-9 h-9 rounded-xl bg-emerald-50 border border-khaki-200 flex items-center justify-center text-[#284139] shrink-0">
          <i class="fa-solid ${g.icon} text-sm"></i>
        </span>
        <div class="min-w-0">
          <h4 class="font-bold text-sm text-slate-900">${g.title}</h4>
          <p class="text-xs text-slate-400">${g.sub}</p>
        </div>
        <span class="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">${gi + 1} / ${GRADE_GROUPS.length}</span>
      </div>
      <!-- Two-up while the cards have the page width; one-up from lg, where
           they sit in the narrow right column beside the teardown. -->
      <div class="grid sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
        ${g.options.map(o => `
        <button type="button" onclick="setGrade('${g.key}','${o.v}')"
                data-grade="${g.key}" data-val="${o.v}"
                aria-pressed="${S.grades[g.key] === o.v}"
                class="grade-tile${S.grades[g.key] === o.v ? ' on' : ''}">
          <span class="grade-tile-txt">
            <span class="grade-tile-label">${o.label}</span>
            <span class="grade-tile-desc">${o.desc}</span>
          </span>
          <span class="grade-dot"></span>
        </button>`).join('')}
      </div>
    </div>`).join('');
}

function setGrade(key, value) {
  S.grades[key] = value;
  document.querySelectorAll(`[data-grade="${key}"]`).forEach(el => {
    const on = el.dataset.val === value;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
  });
  refreshGradeEstimate();
}

function resetGrades() {
  S.grades = defaultGrades();
  renderGradeCards();
  refreshGradeEstimate();
  toast('Grades reset to mint.');
}

/* Single source of truth for the Sell tab's numbers: the live panel, the
   teardown burst, the exploded grid and the BOM ledger all read this. */
function computeQuote() {
  const val = (id, fallback) => {
    const el = document.getElementById(id);
    return (el && el.value) ? el.value : fallback;
  };
  const brand    = val('sel-brand', 'realme');
  const model    = val('sel-model', 'Realme Narzo 60 (128GB)');
  const buyYear  = parseInt(val('sel-buy-year', '2023'), 10);
  const buyMonth = parseInt(val('sel-buy-month', '8'), 10);

  const nowYear = 2026, nowMonth = 8;
  const ageMonths = Math.max(1, (nowYear - buyYear) * 12 + (nowMonth - buyMonth));

  const bom = BOM_BASE[brand] || BOM_BASE.realme;
  const aged = (base) => base * Math.pow(1 - bom.decay, ageMonths);

  const vals = {}, mintVals = {}, tags = {}, deducts = [];
  let score = 0;

  GRADE_GROUPS.forEach(g => {
    const opt  = gradeOption(g);
    const mint = Math.round(aged(bom[g.part]));
    const v    = Math.round(mint * opt.mult);
    mintVals[g.part] = mint;
    vals[g.part]     = v;
    tags[g.key]      = opt.tag || opt.label;
    score += g.weight * opt.mult;
    if (mint > v) deducts.push({ title: g.title, label: opt.label, amount: mint - v });
  });

  const sum       = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const gross     = sum(vals);
  const mintGross = sum(mintVals);
  const pct       = Math.round(score * 100);
  const band      = GRADE_BANDS.find(b => pct >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];

  return {
    brand, model, ageMonths, buyYear, vals, mintVals, tags, deducts, band, pct,
    gross, mintGross,
    net:     Math.round(gross * 0.82),        // 18% platform fee, as printed
    mintNet: Math.round(mintGross * 0.82),
    mult:    score
  };
}

/* The five priced parts, in the order they are drawn down the diagram:
   [SVG label id, BOM key, ledger title, ledger icon]. */
const EXPLODE_PARTS = [
  ['ex-display', 'display', 'Display Panel',   'fa-mobile-screen'],
  ['ex-logic',   'logic',   'Logic Board',     'fa-microchip'],
  ['ex-battery', 'battery', 'Battery Cell',    'fa-car-battery'],
  ['ex-camera',  'camera',  'Camera Module',   'fa-camera'],
  ['ex-chassis', 'chassis', 'Chassis & Frame', 'fa-crop-simple']
];

/* Repaints the pricing window under the diagram — headline payout, grade ring,
   BOM ledger and deductions — and, once the phone is apart, the figures beside
   the parts themselves. Returns the quote so callers that need the numbers
   (runDisassembly) do not compute them twice. */
function refreshGradeEstimate() {
  const q = computeQuote();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const rupees = (n) => '₹' + n.toLocaleString('en-IN');

  set('grade-value', rupees(q.net));
  set('grade-value-sub', `${q.model} · after 18% platform fee`);
  set('grade-age-chip', `${q.ageMonths} months old`);
  set('grade-score', q.pct);
  set('grade-band', q.band.label);
  set('grade-mint', rupees(q.mintNet));

  const ring = document.getElementById('grade-ring');
  if (ring) {
    const c = 2 * Math.PI * 26;
    ring.style.strokeDasharray = `${(q.pct / 100 * c).toFixed(1)} ${c.toFixed(1)}`;
    ring.style.stroke = q.band.ring;
  }
  const bandEl = document.getElementById('grade-band');
  if (bandEl) bandEl.style.color = q.band.ring;

  // BOM ledger: one row per part, sharing the diagram's order.
  const rows = document.getElementById('bom-rows');
  if (rows) {
    const partGrade = GRADE_GROUPS.reduce((acc, g) => { acc[g.part] = gradeOption(g).label; return acc; }, {});
    rows.innerHTML = EXPLODE_PARTS.map(([, key, title, icon]) => {
      const v = q.vals[key];
      const pct = q.gross ? Math.round((v / q.gross) * 100) : 0;
      return `
      <div class="p-2.5 rounded-xl bg-white/5 border border-white/10">
        <div class="flex justify-between text-xs mb-1.5">
          <span class="font-bold text-white flex items-center gap-1.5"><i class="fa-solid ${icon} text-khaki-300"></i>${title}</span>
          <span class="font-black text-khaki-300">${rupees(v)}</span>
        </div>
        <div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div class="h-full bg-khaki-300 rounded-full transition-all duration-500" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>${pct}% of BOM</span>
          <span>Graded: ${partGrade[key]}</span>
        </div>
      </div>`;
    }).join('');
  }

  const list = document.getElementById('grade-deducts');
  if (list) {
    list.innerHTML = q.deducts.length
      ? q.deducts.map(d => `
        <div class="flex items-center justify-between gap-3 text-xs py-1">
          <span class="text-slate-300 truncate"><span class="font-bold text-white">${d.title}</span> · ${d.label}</span>
          <span class="font-black text-terra-300 whitespace-nowrap">−${rupees(d.amount)}</span>
        </div>`).join('')
      : '<p class="text-xs font-bold text-khaki-300 py-1">No deductions — graded as mint.</p>';
  }

  const condField = document.getElementById('sel-cond');
  if (condField) condField.value = q.band.cond;

  // Once the parts are apart their figures stay live, so re-grading after a
  // teardown updates the callouts too.
  if (isTornDown()) EXPLODE_PARTS.forEach(([, key]) => setPartValue(key, rupees(q.vals[key])));

  return q;
}


/* ── 6b. WebGL teardown ──────────────────────────────────────────────────
   A real exploded 3D view of the device: every part is built from geometry
   (rounded slabs, cylinders, tori), seated where it actually sits inside the
   phone, and separated along the phone's thickness axis when the teardown
   runs. The camera pulls back and swings round as they part, and the viewer
   can drag to orbit.

   It is strictly an upgrade over the SVG teardown, never a requirement: if
   three.js did not load, or the GPU has no WebGL, init() returns false and
   the page keeps the SVG. Everything outside this module talks to it through
   Teardown3D.ready / .explode() / .assemble() / .setValue(), all of which are
   safe to call when it never started.

   Units are centimetres — the device is 7.1 × 14.6 × 0.8, so part sizes read
   like a spec sheet rather than arbitrary scene units.
   ────────────────────────────────────────────────────────────────────────── */

const Teardown3D = (function () {
  const W = 7.1, H = 14.6;                 // device footprint
  const EXPLODE_MS = 1500;                 // separation, start to settle
  // Camera on a spherical rig: tight and near-square on the assembled device,
  // pulled back and swung round once the stack has to be read edge-on.
  // Looking down on the assembled phone as it lies on the bench, then
  // dropping towards its own level as it lifts apart — which is the angle
  // that reads the separated layers as a stack of plates.
  const SEAT = { r: 31, az: 0.22, el: 0.95 };
  const APART = { r: 40, az: 0.30, el: 0.34 };

  /* Every layer gets its own material, because a teardown where each part is
     a different substance is the whole point — cover glass, brushed midframe,
     blue FR-4, a graphite cell, sapphire lenses, copper windings and a warm
     titanium shell. The page's khaki and Egyptian Earth still run through it
     as the gilding and the coil, so it belongs to the same UI. */
  const M = {
    glass:    { color: 0x070A11, metalness: 0.62, roughness: 0.15 },  // cover glass, blue-black
    screen:   { color: 0x04060A, metalness: 0.00, roughness: 0.44, emissive: 0x0A2331, emissiveIntensity: 0.14 },
    steel:    { color: 0x8E979C, metalness: 0.95, roughness: 0.28 },  // midframe rails, taptic shell
    nickel:   { color: 0x848F96, metalness: 0.92, roughness: 0.18 },  // shield cans
    gold:     { color: 0xE3B85C, metalness: 0.98, roughness: 0.17 },  // pads, connectors, lens rings
    board:    { color: 0x18376E, metalness: 0.25, roughness: 0.58 },  // FR-4, blue
    chip:     { color: 0x0D1016, metalness: 0.42, roughness: 0.36 },  // packaged dies
    cell:     { color: 0x343A42, metalness: 0.35, roughness: 0.54 },  // graphite battery pouch
    cellTrim: { color: 0xE8C071, metalness: 0.28, roughness: 0.50 },  // printed cell label
    housing:  { color: 0x554C42, metalness: 0.88, roughness: 0.34 },  // warm titanium shell
    dark:     { color: 0x0A0D11, metalness: 0.36, roughness: 0.44 },
    lens:     { color: 0x123A63, metalness: 0.60, roughness: 0.05 },  // sapphire
    copper:   { color: 0xC46A2A, metalness: 0.92, roughness: 0.27 },  // charging windings
    amber:    { color: 0xF3B24A, metalness: 0.40, roughness: 0.30, emissive: 0x6B4410, emissiveIntensity: 0.7 }
  };

  let renderer, scene, camera, root, raf = null;
  let parts = [];              // { group, key, seatZ, apartZ, spin, anchor, label }
  let labelHost, canvas, host;
  let ready = false;
  let progress = 0, from = 0, to = 0, tweenStart = 0, tweening = false;
  let drag = { on: false, x: 0, y: 0, az: 0, el: 0 };
  let idle = 0, visible = true, reduced = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const mat = (spec) => new THREE.MeshStandardMaterial(spec);

  /* A rounded rectangular slab — the shape almost every part in a phone is. */
  function slab(w, h, d, r, spec) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x, y + r);
    s.lineTo(x, y + h - r);
    s.quadraticCurveTo(x, y + h, x + r, y + h);
    s.lineTo(x + w - r, y + h);
    s.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
    s.lineTo(x + w, y + r);
    s.quadraticCurveTo(x + w, y, x + w - r, y);
    s.lineTo(x + r, y);
    s.quadraticCurveTo(x, y, x, y + r);
    const bevel = Math.min(0.05, d * 0.22);
    const g = new THREE.ExtrudeGeometry(s, {
      depth: d - bevel * 2, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: 2, curveSegments: 8
    });
    g.translate(0, 0, -d / 2);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat(spec));
  }

  function box(w, h, d, spec) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(spec));
  }

  /* Cylinders model screws and lenses, both of which point down the Z axis. */
  function puck(r, d, spec, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, seg), mat(spec));
    m.rotation.x = Math.PI / 2;
    return m;
  }

  function at(mesh, x, y, z) { mesh.position.set(x, y, z || 0); return mesh; }

  // ── the seven layers ───────────────────────────────────────────────────

  function buildDisplay() {
    const g = new THREE.Group();
    g.add(slab(W, H, 0.22, 0.85, M.glass));
    const screen = slab(W - 0.5, H - 0.7, 0.04, 0.6, M.screen);
    g.add(at(screen, 0, 0, 0.13));
    g.add(at(box(1.9, 0.28, 0.06, M.dark), 0, H / 2 - 0.75, 0.15));   // earpiece
    g.add(at(puck(0.13, 0.06, M.lens, 12), 1.3, H / 2 - 0.75, 0.15)); // front camera
    g.add(at(box(1.5, 1.1, 0.05, M.gold), 0.9, -H / 2 + 0.75, -0.18)); // OLED flex tail
    return g;
  }

  function buildFasteners() {
    const g = new THREE.Group();
    // midframe: four rails rather than a plate, so you can see through it
    const railY = slab(0.34, H - 1.2, 0.16, 0.12, M.steel);
    g.add(at(railY.clone(), -W / 2 + 0.3, 0, 0));
    g.add(at(railY.clone(), W / 2 - 0.3, 0, 0));
    const railX = slab(W - 0.9, 0.34, 0.16, 0.12, M.steel);
    g.add(at(railX.clone(), 0, H / 2 - 0.35, 0));
    g.add(at(railX.clone(), 0, -H / 2 + 0.35, 0));
    // shield cans over the board area
    g.add(at(slab(2.3, 1.5, 0.18, 0.18, M.nickel), -1.3, 4.4, 0));
    g.add(at(slab(1.9, 1.2, 0.18, 0.18, M.nickel), 1.4, 4.5, 0));
    // screws
    [[-2.6, 6.6], [2.6, 6.6], [-2.9, 0.4], [2.9, 0.4], [-2.6, -6.5], [2.6, -6.5]]
      .forEach(([x, y]) => {
        const s = puck(0.19, 0.20, M.gold, 14);
        g.add(at(s, x, y, 0.02));
        const slot = box(0.26, 0.05, 0.04, M.chip);
        g.add(at(slot, x, y, 0.13));
      });
    return g;
  }

  function buildBoard() {
    const g = new THREE.Group();
    const upper = slab(W - 1.0, 4.4, 0.16, 0.22, M.board);
    g.add(at(upper, 0, 4.3, 0));
    const lower = slab(W - 1.0, 3.2, 0.16, 0.22, M.board);
    g.add(at(lower, 0, 0.5, 0));
    // dies and cans
    [[-1.6, 5.2, 1.3, 1.3], [0.2, 5.3, 1.0, 1.0], [1.5, 5.2, 0.8, 0.9],
     [-1.5, 3.5, 1.1, 0.9], [0.6, 3.4, 1.6, 0.8],
     [-1.4, 1.2, 1.2, 1.0], [0.7, 1.1, 1.5, 0.9], [-1.2, -0.5, 1.0, 0.8]]
      .forEach(([x, y, w, h]) => g.add(at(box(w, h, 0.14, M.chip), x, y, 0.15)));
    // gold connectors and the board-to-board stack
    [[-2.4, 6.0], [2.4, 6.0], [2.5, 3.0], [-2.5, 1.8], [2.4, -0.6]]
      .forEach(([x, y]) => g.add(at(box(0.5, 0.9, 0.12, M.gold), x, y, 0.14)));
    g.add(at(box(1.2, 0.4, 0.30, M.gold), 0, 2.4, 0));
    return g;
  }

  function buildBattery() {
    const g = new THREE.Group();
    g.add(at(slab(W - 1.1, 7.0, 0.52, 0.28, M.cell), 0, -3.4, 0));
    g.add(at(box(W - 1.9, 0.10, 0.02, M.steel), 0, -3.4, 0.28));   // cell seam
    g.add(at(box(1.9, 0.22, 0.02, M.cellTrim), -0.9, -1.2, 0.28));  // printed label
    g.add(at(box(1.3, 0.18, 0.02, M.cellTrim), -1.2, -1.7, 0.28));
    g.add(at(box(0.9, 1.4, 0.06, M.gold), 2.6, 0.4, 0));           // battery flex
    g.add(at(box(0.7, 0.5, 0.16, M.gold), 2.6, 1.2, 0));
    return g;
  }

  function buildCameras() {
    const g = new THREE.Group();
    // rear camera module, top-left where it really lives
    const body = slab(2.7, 3.5, 0.55, 0.55, M.dark);
    g.add(at(body, -1.9, 5.2, 0));
    [[-2.4, 5.9], [-2.4, 4.5]].forEach(([x, y]) => {
      g.add(at(puck(0.62, 0.42, M.gold, 26), x, y, 0.10));
      g.add(at(puck(0.44, 0.46, M.lens, 26), x, y, 0.16));
      g.add(at(puck(0.16, 0.48, M.amber, 14), x - 0.16, y + 0.16, 0.20));
    });
    g.add(at(puck(0.26, 0.40, M.amber, 16), -1.0, 5.2, 0.12));      // flash
    // taptic engine and loudspeaker down at the bottom
    g.add(at(slab(2.6, 1.3, 0.52, 0.16, M.steel), -0.9, -6.1, 0));
    g.add(at(box(1.8, 0.7, 0.30, M.chip), -0.9, -6.1, 0.20));
    g.add(at(slab(1.7, 1.5, 0.52, 0.20, M.dark), 2.0, -6.0, 0));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      g.add(at(puck(0.08, 0.06, M.chip, 8), 1.6 + i * 0.4, -6.4 + j * 0.4, 0.28));
    }
    return g;
  }

  function buildCoil() {
    const g = new THREE.Group();
    [1.55, 1.25, 0.95, 0.65].forEach(r => {
      g.add(at(new THREE.Mesh(new THREE.TorusGeometry(r, 0.055, 8, 56), mat(M.copper)), 0, -1.2, 0));
    });
    g.add(at(box(1.6, 0.10, 0.06, M.copper), 1.9, -0.4, 0));         // coil lead
    g.add(at(box(0.8, 0.4, 0.10, M.gold), 2.8, -0.4, 0));
    g.add(at(box(2.8, 0.55, 0.06, M.nickel), -1.7, 2.3, 0));         // NFC ribbon
    return g;
  }

  function buildHousing() {
    const g = new THREE.Group();
    g.add(slab(W + 0.18, H + 0.18, 0.80, 0.95, M.housing));
    g.add(at(slab(W - 0.5, H - 0.5, 0.10, 0.7, M.dark), 0, 0, 0.36)); // cavity floor
    const bump = slab(2.9, 3.7, 0.34, 0.85, M.dark);
    g.add(at(bump, -1.9, 5.1, -0.52));                                // camera bump
    [[-2.5, 5.8], [-2.5, 4.4], [-1.2, 5.1]].forEach(([x, y]) =>
      g.add(at(puck(0.42, 0.24, M.dark, 20), x, y, -0.66)));
    // antenna bands, inset into the long edges rather than proud of them
    [5.4, -5.4].forEach(y => {
      g.add(at(box(0.16, 0.9, 0.84, M.steel), -(W + 0.18) / 2 + 0.06, y, 0));
      g.add(at(box(0.16, 0.9, 0.84, M.steel), (W + 0.18) / 2 - 0.06, y, 0));
    });
    return g;
  }

  /* Front of the stack to the back: seatZ is where the part sits in the
     assembled device, apartZ where it travels to. */
  const LAYERS = [
    { key: 'display', build: buildDisplay,   seatZ:  0.30, apartZ:  8.4, spin: -0.05 },
    { key: null,      build: buildFasteners, seatZ:  0.14, apartZ:  5.6, spin:  0.04 },
    { key: 'logic',   build: buildBoard,     seatZ:  0.02, apartZ:  2.8, spin: -0.03 },
    { key: 'battery', build: buildBattery,   seatZ: -0.10, apartZ:  0.0, spin:  0.02 },
    { key: 'camera',  build: buildCameras,   seatZ: -0.16, apartZ: -2.8, spin: -0.04 },
    { key: null,      build: buildCoil,      seatZ: -0.24, apartZ: -5.6, spin:  0.05 },
    { key: 'chassis', build: buildHousing,   seatZ: -0.34, apartZ: -8.4, spin: -0.02 }
  ];

  /* Callouts stand off the right-hand edge of the stack. Local +Y runs along
     the device's length, which is left-to-right on screen once it is lying
     flat, so this is simply how far past the end of each plate its chip sits.
     The plates are already separated vertically, so nothing else is needed to
     keep the five of them apart. */
  const LABEL_REACH = H / 2 + 0.8;

  /* Each callout is tinted to the material of the part it names, so the chip
     and the object it points at are obviously the same thing. */
  const LABEL_ACCENT = {
    display: '#2F7C93', logic: '#3A5EA8', battery: '#555C55',
    camera: '#A87423', chassis: '#8A6A44'
  };

  const LABEL_TEXT = {
    display: 'Display', logic: 'Board', battery: 'Battery',
    camera: 'Cameras', chassis: 'Chassis'
  };

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function buildScene() {
    scene = new THREE.Scene();
    root = new THREE.Group();
    // The device is modelled portrait and face-on. This lays it flat on the
    // bench in landscape — its length runs across the stage, its width into
    // it, and its thickness axis points straight up — so the layers stack
    // like a sandwich instead of fanning sideways.
    root.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    scene.add(root);

    // Bright sky over a warm ivory floor: the parts sit on a white stage, so
    // the scene has to be lit like a lightbox rather than a dark bench.
    scene.add(new THREE.HemisphereLight(0xFFF7EA, 0xE3DCCC, 0.62));
    const key = new THREE.DirectionalLight(0xFFFAF0, 0.90); key.position.set(11, 13, 16);
    // A cool fill opposite a warm rim: the cross-light is what separates
    // brushed steel from gold from copper instead of flattening them.
    const fill = new THREE.DirectionalLight(0x8FB2CE, 0.28); fill.position.set(-13, -5, 9);
    const rim = new THREE.PointLight(0xE9A722, 0.55, 110); rim.position.set(-16, 10, -7);
    scene.add(key, fill, rim);

    parts = LAYERS.map((spec, i) => {
      const group = spec.build();
      group.position.z = spec.seatZ;
      root.add(group);
      return {
        key: spec.key, group, i,
        seatZ: spec.seatZ, apartZ: spec.apartZ, spin: spec.spin,
        anchor: new THREE.Vector3(),
        label: spec.key ? makeLabel(spec.key) : null
      };
    });
  }

  function makeLabel(key) {
    const el = document.createElement('div');
    el.className = 'td-label';
    el.style.setProperty('--td-accent', LABEL_ACCENT[key]);
    el.innerHTML = `<span class="td-dot"></span><span class="td-stem"></span><span class="td-txt">
      <span class="td-name">${LABEL_TEXT[key]}</span>
      <span class="td-val" data-part3d="${key}">₹0</span></span>`;
    labelHost.appendChild(el);
    return el;
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function placeCamera(t) {
    const lerp = (a, b) => a + (b - a) * t;
    const r = lerp(SEAT.r, APART.r);
    const az = lerp(SEAT.az, APART.az) + drag.az + Math.sin(idle) * 0.10 * (1 - drag.on);
    const el = clamp(lerp(SEAT.el, APART.el) + drag.el, -0.7, 0.9);
    camera.position.set(
      r * Math.sin(az) * Math.cos(el),
      r * Math.sin(el),
      r * Math.cos(az) * Math.cos(el)
    );
    // Aimed a little right of the stack as it opens, which slides the plates
    // left and leaves the callout column its own room.
    camera.lookAt(lerp(0, 2.4), 0, 0);
  }

  /* Labels are HTML, so each frame their anchor is projected into the canvas
     box. Anchors ride the part's right edge and only show once apart. */
  function placeLabels(t) {
    const w = host.clientWidth, h = host.clientHeight;
    root.updateMatrixWorld(true);
    parts.forEach(p => {
      if (!p.label) return;
      if (t < 0.35) { p.label.style.opacity = '0'; return; }
      p.anchor.set(0, LABEL_REACH, p.group.position.z);
      root.localToWorld(p.anchor);          // the device is turned; the anchor turns with it
      p.anchor.project(camera);
      const x = (p.anchor.x * 0.5 + 0.5) * w;
      const y = (-p.anchor.y * 0.5 + 0.5) * h;
      p.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(0, -50%)`;
      p.label.style.opacity = String(clamp((t - 0.35) / 0.3, 0, 1));
    });
  }

  function apply(t) {
    parts.forEach(p => {
      // Each part leaves a beat after the one in front of it.
      const local = easeOut(clamp((t - p.i * 0.07) / 0.6, 0, 1));
      p.group.position.z = p.seatZ + (p.apartZ - p.seatZ) * local;
      p.group.rotation.z = p.spin * local;
    });
    placeCamera(easeOut(t));
    placeLabels(t);
  }

  function frame(now) {
    raf = null;
    if (tweening) {
      const p = clamp((now - tweenStart) / EXPLODE_MS, 0, 1);
      progress = from + (to - from) * p;
      if (p >= 1) { progress = to; tweening = false; }
    }
    if (!drag.on && !reduced) idle += 0.0022;
    apply(progress);
    renderer.render(scene, camera);
    if (tweening || (visible && !reduced) || drag.on) raf = requestAnimationFrame(frame);
  }

  function kick() { if (raf === null) raf = requestAnimationFrame(frame); }

  function tweenTo(target) {
    if (reduced) { progress = target; apply(progress); renderer.render(scene, camera); return; }
    from = progress; to = target; tweenStart = performance.now(); tweening = true;
    kick();
  }

  function bindDrag() {
    const down = (e) => {
      drag.on = true; drag.x = e.clientX; drag.y = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      kick();
    };
    const move = (e) => {
      if (!drag.on) return;
      // Negated so the device turns with the pointer: sweeping right swings
      // the camera left, which carries the model right.
      drag.az -= (e.clientX - drag.x) * 0.006;
      drag.el += (e.clientY - drag.y) * 0.004;
      drag.el = clamp(drag.el, -0.55, 0.75);
      drag.x = e.clientX; drag.y = e.clientY;
      kick();
    };
    const up = (e) => { drag.on = false; canvas.releasePointerCapture?.(e.pointerId); };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function init() {
    if (ready) return true;
    if (typeof THREE === 'undefined' || !webglAvailable()) return false;
    host = document.getElementById('teardown-3d');
    canvas = document.getElementById('teardown-canvas');
    labelHost = document.getElementById('teardown-labels');
    if (!host || !canvas || !labelHost) return false;

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    // Filmic roll-off: without it the specular on the glass clips to white and
    // the screen reads as lit rather than off.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.00;

    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    reduced = prefersReducedMotion();
    buildScene();

    host.classList.remove('hidden');
    const svg = document.getElementById('phone-shell');
    if (svg) svg.classList.add('hidden');
    const stage = document.getElementById('disassembly-stage-container');
    if (stage) stage.classList.add('stage-light');

    resize();
    if (window.ResizeObserver) new ResizeObserver(() => { resize(); kick(); }).observe(host);
    else window.addEventListener('resize', () => { resize(); kick(); });

    // Only spin while it is actually on screen and the tab is in front.
    if (window.IntersectionObserver) {
      new IntersectionObserver((es) => {
        visible = es[0].isIntersecting;
        if (visible) kick();
      }, { threshold: 0.05 }).observe(host);
    }
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden && visible;
      if (!document.hidden) kick();
    });

    bindDrag();
    ready = true;
    apply(0);
    renderer.render(scene, camera);
    kick();
    return true;
  }

  return {
    init,
    get ready() { return ready; },
    get exploded() { return progress > 0.5; },
    explode() { tweenTo(1); },
    assemble() { drag.az = 0; drag.el = 0; tweenTo(0); },
    /* Snap without animating — used when a grade changes after a teardown. */
    setValue(key, text) {
      const el = labelHost && labelHost.querySelector(`[data-part3d="${key}"]`);
      if (el) el.textContent = text;
    },
    durationMs: EXPLODE_MS
  };
})();


/* ── 6c. Teardown separation ─────────────────────────────────────────────
   Two renderers, one script. When WebGL is up, Teardown3D pulls the parts
   apart in real 3D; otherwise the SVG does the same move in two dimensions
   (.exploded drops the translate holding each part inside the phone). The
   figures, the flash and the timing are shared, so the sequence reads the
   same either way. Skipped outright under prefers-reduced-motion. */

const SETTLED_HINT = 'Every part separated and valued at today’s component spot rates.';

const isTornDown = () => {
  if (Teardown3D.ready) return Teardown3D.exploded;
  const phone = document.getElementById('phone-explode');
  return !!phone && phone.classList.contains('exploded');
};

/* One part figure, written wherever it is currently shown. */
function setPartValue(key, text) {
  const el = document.getElementById('ex-' + key);
  if (el) el.textContent = text;
  if (Teardown3D.ready) Teardown3D.setValue(key, text);
}

function countUpRupees(key, target, dur = 700) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    setPartValue(key, '₹' + Math.round(target * eased).toLocaleString('en-IN'));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function playExplosion(q, onSettled) {
  const use3D = Teardown3D.ready;
  const phone = document.getElementById('phone-explode');
  const hint = document.getElementById('explode-hint');
  const price = (key) => '₹' + q.vals[key].toLocaleString('en-IN');
  if (!use3D && !phone) { onSettled(); return; }

  const separate = () => {
    if (use3D) Teardown3D.explode();
    else phone.classList.add('exploded');
  };

  if (prefersReducedMotion()) {
    EXPLODE_PARTS.forEach(([, key]) => setPartValue(key, price(key)));
    separate();
    if (hint) hint.textContent = SETTLED_HINT;
    onSettled();
    return;
  }

  if (!use3D) phone.classList.remove('exploded');
  if (hint) hint.textContent = 'Releasing screws and separating the stack…';

  // Straight into the separation — no wind-up.
  requestAnimationFrame(() => {
    separate();

    // Each figure lands just as its part finishes travelling.
    EXPLODE_PARTS.forEach(([, key], i) => {
      setTimeout(() => countUpRupees(key, q.vals[key], 620), 380 + i * 90);
    });
  });

  setTimeout(() => {
    if (hint) hint.textContent = SETTLED_HINT;
    onSettled();
  }, (use3D ? Teardown3D.durationMs : 1560) + 120);
}


/* ── 6d. Teardown ────────────────────────────────────────────────────────
   runDisassembly() locks the quote and starts the separation; the badge,
   ledger note and trend chart are settled by applyTeardownResults(). */

function runDisassembly() {
  if (S.tearingDown) return;              // a teardown is mid-flight; let it land
  const q = refreshGradeEstimate();
  S.currentQuotedModel = q.model;
  S.tearingDown = true;

  const stage = document.getElementById('disassembly-stage-container');
  if (stage) stage.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

  const badge = document.getElementById('dis-badge');
  if (badge) {
    badge.textContent = 'Separating hardware…';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800';
  }

  // The quote is the seller's record, so it lands whether or not they stay to
  // watch the animation out.
  const quotes = window.DB.get('quotes', []);
  const existingIdx = quotes.findIndex(x => x.title === q.model);
  if (existingIdx >= 0) {
    quotes[existingIdx].price = q.net;
    quotes[existingIdx].condition = q.band.cond;
  } else {
    quotes.unshift({ id: 'q-' + Date.now(), title: q.model, condition: q.band.cond, price: q.net, status: 'Quote Locked', hub: 'Bhatpara Central' });
  }
  window.DB.set('quotes', quotes);

  playExplosion(q, () => { S.tearingDown = false; applyTeardownResults(q); });
}

function applyTeardownResults(q) {
  const badge = document.getElementById('dis-badge');
  if (badge) {
    badge.textContent = '✓ Hardware Disassembled';
    badge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800';
  }

  const ageLabel = document.getElementById('bom-age-label');
  if (ageLabel) {
    ageLabel.textContent =
      `Quote locked · Age ${q.ageMonths} months (${q.buyYear}) · Grade ${q.band.label} ${q.pct}/100 · Fee 18%`;
  }

  renderTrendChartRealistic(q.brand, q.mult, q.ageMonths);
  toast(`Teardown calculated for ${q.model}: ₹${q.net.toLocaleString('en-IN')}`);
}


function renderTrendChartRealistic(brand, mult, ageMonths) {
  const b = BOM_BASE[brand] || BOM_BASE.realme;
  const labels = ['W1 May', 'W2 May', 'W3 May', 'W4 May', 'W1 Jun', 'W2 Jun', 'W3 Jun', 'W4 Jun', 'W1 Jul', 'W2 Jul', 'W3 Jul', 'W4 Jul'];
  
  const simulateCurve = (base, volatility) => {
    return [
      Math.round(base * mult * 1.08),
      Math.round(base * mult * 1.06 + Math.sin(1) * volatility),
      Math.round(base * mult * 1.03),
      Math.round(base * mult * 1.05 + Math.cos(2) * volatility),
      Math.round(base * mult * 1.01),
      Math.round(base * mult * 0.98),
      Math.round(base * mult * 0.96 - volatility),
      Math.round(base * mult * 0.94),
      Math.round(base * mult * 0.95 + volatility * 0.5),
      Math.round(base * mult * 0.91),
      Math.round(base * mult * 0.88),
      Math.round(base * mult * 0.85)
    ];
  };

  // Palette validated for CVD + contrast on white (dataviz six-checks); the one
  // floor-band pair (sky/purple) is disambiguated by distinct point markers.
  const gradFill = (hex) => (ctx) => {
    const { chart } = ctx;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return hex + '14';
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, hex + '2e');
    g.addColorStop(1, hex + '00');
    return g;
  };

  const mkSeries = (label, data, hex, pointStyle) => ({
    label, data,
    borderColor: hex,
    backgroundColor: gradFill(hex),
    pointBackgroundColor: hex,
    pointBorderColor: '#ffffff',
    pointBorderWidth: 1.5,
    pointStyle,
    fill: true,
    tension: 0.35,
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 6,
    pointHitRadius: 14
  });

  const ds = [
    mkSeries('Display Panel', simulateCurve(b.display, 180), '#284139', 'circle'),
    mkSeries('Logic Board', simulateCurve(b.logic, 240), '#F8D794', 'rectRot'),
    mkSeries('Camera Module', simulateCurve(b.camera, 140), '#809076', 'triangle'),
    mkSeries('Battery Cell', simulateCurve(b.battery, 60), '#B86830', 'rect')
  ];

  if (S.chartInst) S.chartInst.destroy();
  const ctx = document.getElementById('trend-chart').getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  S.chartInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: reduceMotion ? false : {
        duration: 900,
        easing: 'easeOutQuart',
        delay: (c) => (c.type === 'data' && c.mode === 'default') ? c.dataIndex * 40 + c.datasetIndex * 140 : 0
      },
      transitions: { active: { animation: { duration: 180 } } },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: 11, weight: 'bold' }, color: '#414841' } },
        tooltip: {
          backgroundColor: '#111A19',
          titleColor: '#F8F6F0',
          bodyColor: '#DEDDD1',
          padding: 12,
          cornerRadius: 10,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        y: { grid: { color: '#EFEDE4' }, border: { display: false }, ticks: { color: '#6E756C', callback: v => '₹' + (v / 1000).toFixed(1) + 'k' } },
        x: { grid: { display: false }, border: { display: false }, ticks: { color: '#6E756C', font: { size: 10 } } }
      }
    }
  });
}

function filterChart(idx) {
  if (!S.chartInst) return;
  document.querySelectorAll('#trend-chips .brand-pill').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (idx === 'all') S.chartInst.data.datasets.forEach(d => d.hidden = false);
  else S.chartInst.data.datasets.forEach((d, i) => d.hidden = i !== idx);
  S.chartInst.update();
}


/* ── 7. Vision scan (mock computer-vision estimator) ───────────────────── */

function triggerComputerVisionScan() {
  openModal('vision-modal');
  document.getElementById('vision-status-txt').textContent = 'Scanning smartphone image with AI Computer Vision...';
  setTimeout(() => {
    document.getElementById('vision-status-txt').textContent = 'Pattern Matched: iPhone 13 (128GB) Midnight';
  }, 1200);
}

function applyVisionResult() {
  closeModal('vision-modal');
  document.getElementById('store-search-inp').value = 'iPhone 13';
  applyStoreSearch();
  toast('AI Vision filter applied: iPhone 13');
}


/* ── 8. Storefront: filters, PDP, cart & checkout ──────────────────────── */

function applyStoreSearch() {
  const query = (document.getElementById('store-search-inp').value || '').toLowerCase();
  const seriesSort = document.getElementById('store-series-sort').value;
  renderShop(currentStoreType, currentStoreBrand, query, seriesSort);
}

let currentStoreType = 'dev';
let currentStoreBrand = 'all';

function storeTab(t) {
  currentStoreType = t;
  document.getElementById('st-tab-dev').className = 'px-5 py-2.5 rounded-xl font-bold text-xs ' + (t === 'dev' ? 'bg-[#284139] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900');
  document.getElementById('st-tab-parts').className = 'px-5 py-2.5 rounded-xl font-bold text-xs ' + (t === 'parts' ? 'bg-[#284139] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900');
  renderShop(t, currentStoreBrand);
}

function setShopBrand(b) {
  currentStoreBrand = b;
  document.querySelectorAll('[data-sb]').forEach(el => el.classList.toggle('active', el.dataset.sb === b));
  renderShop(currentStoreType, b);
}

function renderShop(type, brand, query = '', seriesSort = 'all') {
  let items = STORE_ITEMS.filter(i => i.type === type);
  if (brand !== 'all') items = items.filter(i => i.brand === brand);
  if (seriesSort !== 'all') items = items.filter(i => i.series === seriesSort);
  if (query.trim()) items = items.filter(i => i.title.toLowerCase().includes(query) || i.sub.toLowerCase().includes(query));

  const grid = document.getElementById('shop-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="col-span-full p-12 text-center bg-white rounded-3xl border border-slate-100 text-slate-400 font-bold">No devices found matching your filter</div>';
    return;
  }

  grid.innerHTML = items.map(p => `
    <div class="prod-card bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col justify-between">
      <div class="p-6 bg-slate-50 flex items-center justify-center h-36 relative">
        <i class="${p.icon} text-5xl text-[#284139]"></i>
        <span class="absolute top-2.5 left-2.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
          <i class="fa-solid fa-shield-halved mr-1"></i>1-Yr Warranty
        </span>
        <span class="absolute top-2.5 right-2.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 uppercase">
          ${p.series}
        </span>
      </div>
      <div class="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          <h4 class="font-bold text-sm text-slate-900 line-clamp-1">${p.title}</h4>
          <p class="text-[11px] text-slate-400 mt-0.5">${p.sub}</p>
        </div>
        <div>
          <div class="flex items-baseline gap-2 mb-2.5">
            <span class="text-lg font-black text-[#284139]">₹${p.price.toLocaleString('en-IN')}</span>
            <span class="text-xs text-slate-400 line-through">₹${p.orig.toLocaleString('en-IN')}</span>
          </div>
          <div class="flex gap-2">
            <button onclick="addToCart(${p.id})" class="flex-1 py-2 rounded-xl bg-[#284139] hover:bg-[#1E3129] text-white font-bold text-xs transition-colors flex items-center justify-center gap-1">
              <i class="fa-solid fa-cart-plus"></i> Add
            </button>
            <button onclick="openPDP(${p.id})" class="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs">
              View
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

/* The cart lives in S.cartItems as one entry per unit. The panel groups those
   by device so three of the same handset read as a line with a quantity rather
   than three identical rows; totals and the badge stay driven by the flat array
   so checkout, which writes one order per unit, needs no separate accounting. */
function renderCart() {
  const box = document.getElementById('cart-items');
  if (!box) return;

  if (!S.cartItems.length) {
    box.innerHTML = '<p class="text-xs text-slate-400 text-center py-8">Your cart is empty.</p>';
    return;
  }

  box.innerHTML = cartLines().map(l => `
    <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/70">
      <div class="w-11 h-11 rounded-xl bg-white border border-slate-100 flex items-center justify-center flex-shrink-0">
        <i class="${l.item.icon} text-lg text-[#284139]"></i>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-bold text-slate-900 truncate">${l.item.title}</p>
        <p class="text-[10px] text-slate-400 truncate">${l.item.sub}</p>
        <p class="text-[10px] font-bold text-emerald-700 mt-0.5"><i class="fa-solid fa-shield-halved mr-1"></i>1-Yr Warranty</p>
      </div>
      <div class="text-right flex-shrink-0">
        <p class="text-xs font-black text-[#284139]">₹${(l.item.price * l.qty).toLocaleString('en-IN')}</p>
        <div class="flex items-center gap-1.5 justify-end mt-1">
          <button onclick="removeFromCart(${l.item.id})" aria-label="Remove one ${l.item.title}"
                  class="w-5 h-5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-[#A85B28] hover:border-[#A85B28] text-[10px] leading-none flex items-center justify-center transition-colors">&minus;</button>
          <span class="text-[11px] font-bold text-slate-700 w-4 text-center">${l.qty}</span>
          <button onclick="addToCart(${l.item.id}, true)" aria-label="Add another ${l.item.title}"
                  class="w-5 h-5 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-[#284139] hover:border-[#284139] text-[10px] leading-none flex items-center justify-center transition-colors">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

function updateCartUI(pop) {
  const badge = document.getElementById('cart-badge');
  badge.textContent = S.cartItems.length;
  if (pop) {
    badge.classList.remove('badge-pop');
    void badge.offsetWidth;
    badge.classList.add('badge-pop');
  }
  document.getElementById('cart-count-label').textContent = `(${S.cartItems.length} item${S.cartItems.length === 1 ? '' : 's'})`;

  // The pledge is a flat ₹5 on an order, so an empty cart owes nothing.
  const sub = S.cartItems.reduce((a, b) => a + b.price, 0);
  const pledge = S.cartItems.length ? 5 : 0;
  document.getElementById('cart-sub').textContent = '₹' + sub.toLocaleString('en-IN');
  document.getElementById('cart-total').textContent = '₹' + (sub + pledge).toLocaleString('en-IN');
  renderCart();
}

function addToCart(id, quiet) {
  const it = STORE_ITEMS.find(i => i.id === id);
  if (!it) return;
  S.cartItems.push(it);
  updateCartUI(true);
  if (!quiet) toast(`${it.title} added to cart (+₹5 Greener India Pledge included)`);
}

function removeFromCart(id) {
  const at = S.cartItems.findIndex(i => i.id === id);
  if (at === -1) return;
  S.cartItems.splice(at, 1);
  updateCartUI(false);
}

/* Writes the basket to the orders table and returns the reference to quote
   back. One record per unit, because the profile lists and warranty-tracks
   each device separately and keys its cards on the order id — so the ids stay
   unique per unit and the first of them is the customer-facing reference.

   This used to be the whole of checkout, called straight from the cart's
   button. It is now the last thing wizPlace() does, after the delivery and
   payment steps have been through. */
function executeCheckoutDatabase(ship, method) {
  if (S.cartItems.length === 0) return '';
  const orders = window.DB.get('orders', []);
  const placedAt = Date.now();
  let ref = '';
  S.cartItems.forEach(it => {
    const id = 'RS-' + Math.floor(10000 + Math.random() * 90000);
    if (!ref) ref = id;
    orders.unshift({
      id: id, title: it.title, price: it.price,
      status: 'Shipped (In Transit)', warrantyDays: 365,
      placedAt: placedAt, payment: method || '', ship: ship || null
    });
  });
  window.DB.set('orders', orders);
  return ref;
}

function openPDP(id) {
  const it = STORE_ITEMS.find(i => i.id === id);
  if (!it) return;
  S.pdpId = it.id;
  nav('pdp');
  document.getElementById('pdp-title').textContent = it.title;
  document.getElementById('pdp-sub').textContent = it.sub;
  document.getElementById('pdp-price').textContent = '₹' + it.price.toLocaleString('en-IN');
  document.getElementById('pdp-orig').textContent = '₹' + it.orig.toLocaleString('en-IN');
  document.getElementById('pdp-icon').className = it.icon + ' text-8xl text-[#284139]';
}

function addToCartFromPDP() {
  addToCart(S.pdpId);
  openModal('cart-modal');
}
function buyNow() {
  addToCart(S.pdpId);
  openModal('cart-modal');
}

/* ── 8c. The checkout wizard ─────────────────────────────────────────────
   "Proceed to Checkout" used to write the orders and close the cart in one
   click, which meant an order was placed before anything had been said about
   where it was going or how it was being paid for, and with no moment at
   which it could be called off.

   It is now four steps — delivery, payment, review, done — behind a rail that
   states the whole shape of the flow at once: how many steps there are, which
   one is open, and which are already behind you. Progress only moves on a
   step that validates, and a cleared step stays clickable so going back to
   fix an address costs one click rather than a restart.

   Nothing is written until the review step is confirmed. The cart is emptied
   in the same breath as the orders being written, so a double-submit cannot
   place the same basket twice, and the busy flag holds the button through the
   one interval in the flow that is not instant. */

const WIZ_LAST  = 4;
const WIZ_NAMES = ['Delivery', 'Payment', 'Review', 'Done'];

let wizStep = 1;      // 1..4
let wizPay  = 'upi';  // 'upi' | 'card' | 'cod'
let wizBusy = false;  // held across the place-order interval

const wizEl = id => document.getElementById(id);
const wizVal = id => (wizEl(id) ? wizEl(id).value.trim() : '');
const wizDigits = s => s.replace(/\D/g, '');

/* One entry per unit in S.cartItems, grouped by device for display. Shared
   with renderCart() so the cart panel and the review step can never disagree
   about what is in the basket. */
function cartLines() {
  const lines = [];
  S.cartItems.forEach(it => {
    const line = lines.find(l => l.item.id === it.id);
    if (line) line.qty++;
    else lines.push({ item: it, qty: 1 });
  });
  return lines;
}

function wizTotals() {
  const sub = S.cartItems.reduce((a, b) => a + b.price, 0);
  const pledge = S.cartItems.length ? 5 : 0;   // flat, per order
  return { sub: sub, pledge: pledge, total: sub + pledge };
}

function openCheckout() {
  if (!S.cartItems.length) { toast('Your cart is empty.'); return; }

  /* Prefilled from the last delivery on this device, falling back to the
     account. Neither is required to have anything in it. */
  const ship = window.DB.get('ship', {});
  const user = window.DB.get('user', {});
  wizEl('wiz-name').value  = ship.name || user.name || '';
  wizEl('wiz-phone').value = ship.phone || '';
  wizEl('wiz-addr').value  = ship.addr || '';
  wizEl('wiz-city').value  = ship.city || user.city || '';
  wizEl('wiz-pin').value   = ship.pin || '';

  wizStep = 1;
  wizBusy = false;
  setPayMethod(wizPay);
  wizClearError();
  closeModal('cart-modal');
  openModal('checkout-modal');
  wizRender();
}

/* The rail, the counter, the visible step and the two buttons all read off
   wizStep — there is one place the flow's position is kept. */
function wizRender() {
  const rail = wizEl('wiz-rail');
  rail.style.setProperty('--wiz-p', (wizStep - 1) / (WIZ_LAST - 1));
  rail.setAttribute('aria-valuenow', wizStep);
  rail.querySelectorAll('.wiz-node').forEach(node => {
    const n = +node.dataset.node;
    node.classList.toggle('done', n < wizStep);
    node.classList.toggle('now', n === wizStep);
  });

  wizEl('wiz-counter').textContent =
    'Step ' + wizStep + ' of ' + WIZ_LAST + ' · ' + WIZ_NAMES[wizStep - 1];

  document.querySelectorAll('#checkout-modal .wiz-step').forEach(s => {
    s.classList.toggle('on', +s.dataset.step === wizStep);
  });

  /* The last step is its own pair of buttons, so the wizard's own footer goes
     away rather than sitting under them saying "Back". */
  wizEl('wiz-actions').style.display = wizStep === WIZ_LAST ? 'none' : 'flex';
  wizEl('wiz-back').style.display = wizStep === 1 ? 'none' : 'block';
  wizEl('wiz-next').textContent =
    wizStep === 3 ? 'Place order · ₹' + wizTotals().total.toLocaleString('en-IN')
                  : 'Continue →';
}

function wizFocus() {
  const first = document.querySelector('#checkout-modal .wiz-step.on .wiz-input');
  if (first) first.focus();
}

function checkoutGo(n) {
  // Backwards only, and not once the order is placed.
  if (wizBusy || wizStep >= WIZ_LAST || n >= wizStep) return;
  wizStep = n;
  wizClearError();
  wizRender();
}

function checkoutBack() {
  if (wizBusy || wizStep <= 1) return;
  wizStep--;
  wizClearError();
  wizRender();
}

function checkoutNext() {
  if (wizBusy) return;
  if (wizStep === 3) return wizPlace();

  const bad = wizValidate(wizStep);
  if (bad) return wizFail(bad[0], bad[1]);

  wizStep++;
  wizClearError();
  if (wizStep === 3) wizReview();
  wizRender();
  wizFocus();
}

/* Returns [message, field id] for the first thing wrong on a step, or null.
   Ordered the way the fields are, so the message always names the field the
   focus lands on. */
function wizValidate(step) {
  if (step === 1) {
    if (wizVal('wiz-name').length < 2)          return ['Please enter the name the courier should ask for.', 'wiz-name'];
    if (wizDigits(wizVal('wiz-phone')).length !== 10) return ['A phone number needs 10 digits.', 'wiz-phone'];
    if (wizVal('wiz-addr').length < 8)          return ['The address needs a house or flat and a street.', 'wiz-addr'];
    if (wizVal('wiz-city').length < 2)          return ['Which city or town is this?', 'wiz-city'];
    if (wizDigits(wizVal('wiz-pin')).length !== 6)   return ['An Indian PIN code is 6 digits.', 'wiz-pin'];
    return null;
  }

  if (step === 2) {
    if (wizPay === 'cod') return null;

    if (wizPay === 'upi') {
      if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(wizVal('wiz-vpa')))
        return ['A UPI ID looks like name@bank.', 'wiz-vpa'];
      return null;
    }

    const num = wizDigits(wizVal('wiz-card'));
    if (num.length < 15 || num.length > 16) return ['A card number is 15 or 16 digits.', 'wiz-card'];

    const exp = wizVal('wiz-exp').split('/');
    const mm = +exp[0], yy = +exp[1];
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0)) return ['Expiry goes in as MM/YY.', 'wiz-exp'];
    /* Compared as year*12+month so December-to-January needs no special
       case; a card is good through the last day of its expiry month. */
    const now = new Date();
    const cardM = (2000 + yy) * 12 + mm;
    const nowM  = now.getFullYear() * 12 + (now.getMonth() + 1);
    if (cardM < nowM) return ['That card has expired.', 'wiz-exp'];
    if (wizDigits(wizVal('wiz-cvv')).length < 3) return ['The CVV is the 3 digits on the back.', 'wiz-cvv'];
    return null;
  }

  return null;
}

function wizFail(msg, id) {
  wizEl('wiz-error-msg').textContent = msg;
  wizEl('wiz-error').classList.remove('hidden');
  const f = wizEl(id);
  if (f) { f.classList.add('bad'); f.focus(); }
}

function wizClearError() {
  wizEl('wiz-error').classList.add('hidden');
  document.querySelectorAll('#checkout-modal .wiz-input.bad')
    .forEach(f => f.classList.remove('bad'));
}

function setPayMethod(m) {
  wizPay = m;
  document.querySelectorAll('#checkout-modal .pay-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.pay === m);
  });
  ['upi', 'card', 'cod'].forEach(k => {
    wizEl('wiz-pay-' + k).classList.toggle('on', k === m);
  });
  wizClearError();
}

function wizPayLabel() {
  if (wizPay === 'cod') return 'Cash or UPI on delivery';
  if (wizPay === 'upi') return 'UPI · ' + (wizVal('wiz-vpa') || 'not set');
  const num = wizDigits(wizVal('wiz-card'));
  return 'Card ending ' + (num.slice(-4) || '—');
}

/* Step 3 is assembled rather than stored: it reads the cart and the two forms
   at the moment it opens, so an edit made by going back is always reflected. */
function wizReview() {
  wizEl('wiz-lines').innerHTML = cartLines().map(l => `
    <div class="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 bg-slate-50/70">
      <div class="w-9 h-9 rounded-lg bg-white border border-slate-100 flex items-center justify-center flex-shrink-0">
        <i class="${l.item.icon} text-[#284139]"></i>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-bold text-slate-900 truncate">${l.item.title}</p>
        <p class="text-[10px] text-slate-400 truncate">${l.item.sub}</p>
      </div>
      <p class="text-[11px] font-bold text-slate-400 flex-shrink-0">&times;${l.qty}</p>
      <p class="text-xs font-black text-[#284139] flex-shrink-0">₹${(l.item.price * l.qty).toLocaleString('en-IN')}</p>
    </div>
  `).join('');

  wizEl('wiz-sum-ship').textContent =
    wizVal('wiz-name') + '\n' + wizVal('wiz-addr') + '\n' +
    wizVal('wiz-city') + ' ' + wizVal('wiz-pin') + '\n' + wizVal('wiz-phone');
  wizEl('wiz-sum-ship').style.whiteSpace = 'pre-line';
  wizEl('wiz-sum-pay').textContent = wizPayLabel();

  const t = wizTotals();
  wizEl('wiz-sub').textContent    = '₹' + t.sub.toLocaleString('en-IN');
  wizEl('wiz-pledge').textContent = '₹' + t.pledge.toLocaleString('en-IN');
  wizEl('wiz-total').textContent  = '₹' + t.total.toLocaleString('en-IN');
}

function wizPlace() {
  if (wizBusy || !S.cartItems.length) return;
  wizBusy = true;

  const btn = wizEl('wiz-next');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Placing order…';

  const ship = {
    name:  wizVal('wiz-name'),
    phone: wizVal('wiz-phone'),
    addr:  wizVal('wiz-addr'),
    city:  wizVal('wiz-city'),
    pin:   wizVal('wiz-pin')
  };
  if (wizEl('wiz-save').checked) window.DB.set('ship', ship);

  /* The only pause in the flow. It is there because an order that appears to
     be placed in nought milliseconds does not read as having been placed at
     all — not to fake a network the prototype does not have. */
  setTimeout(() => {
    const ref = executeCheckoutDatabase(ship, wizPayLabel());
    S.cartItems = [];
    updateCartUI(false);

    wizEl('wiz-ref').textContent = ref;
    wizBusy = false;
    btn.disabled = false;
    btn.textContent = 'Continue →';
    wizStep = WIZ_LAST;
    wizRender();
    renderDatabaseUI();
    launchConfetti();
    toast('Order ' + ref + ' placed. ₹5.00 tree donation confirmed.');
  }, 850);
}

/* Enter moves the wizard on, the way it would in a single form. Textareas
   keep their newline. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const modal = document.getElementById('checkout-modal');
  if (!modal || !modal.classList.contains('open')) return;
  if (e.target && e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  checkoutNext();
});

/* Clear the red on a field as soon as it is being fixed, rather than making
   the reader press Continue again to find out. */
document.addEventListener('input', e => {
  if (e.target && e.target.classList && e.target.classList.contains('bad')) {
    e.target.classList.remove('bad');
    wizEl('wiz-error').classList.add('hidden');
  }
});

// Card fields format as they are typed: 4-digit groups, and MM/YY.
function wizFmtCard(el) {
  const d = wizDigits(el.value).slice(0, 16);
  el.value = d.replace(/(.{4})/g, '$1 ').trim();
}
function wizFmtExp(el) {
  const d = wizDigits(el.value).slice(0, 4);
  el.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
}

/* ── 8b. Contact ───────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function submitContactForm(e) {
  e.preventDefault();
  const name  = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const topic = document.getElementById('contact-topic').value;
  const msg   = document.getElementById('contact-msg').value.trim();

  const err  = document.getElementById('contact-error');
  const errT = document.getElementById('contact-error-msg');
  const fail = (text, focus) => {
    errT.textContent = text;
    err.classList.remove('hidden');
    const el = document.getElementById(focus);
    if (el) el.focus();
  };

  if (!name)                 return fail('Please tell us your name.', 'contact-name');
  if (!EMAIL_RE.test(email)) return fail('That email address does not look right.', 'contact-email');
  if (msg.length < 10)       return fail('A little more detail helps us answer properly.', 'contact-msg');

  err.classList.add('hidden');

  const messages = window.DB.get('messages', []);
  messages.unshift({
    id: 'MSG-' + Math.floor(10000 + Math.random() * 90000),
    name, email, topic, message: msg,
    sentAt: new Date().toISOString()
  });
  window.DB.set('messages', messages);

  e.target.reset();
  toast(`Thanks ${name.split(' ')[0]} — we'll reply to ${email} within 1 working day.`);
}


function askAdvisorAboutCurrentModel() {
  nav('advisor');
  setTimeout(() => {
    quickChat(`What is the optimal 14-day sell window for ${S.currentQuotedModel || 'my smartphone'}?`);
  }, 350);
}


/* ── 9. AI advisor chat ────────────────────────────────────────────────── */

function sendChat() {
  const inp = document.getElementById('chat-inp');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  quickChat(t);
}

function quickChat(promptText) {
  appendChatMsg('user', promptText);

  // Typing indicator while the "advisor" thinks
  const log = document.getElementById('chat-log');
  const typing = document.createElement('div');
  typing.className = 'flex items-start gap-2.5 max-w-xl';
  typing.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-[#284139] text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
      <i class="fa-solid fa-robot"></i>
    </div>
    <div class="bubble-bot p-4 rounded-2xl rounded-tl-none shadow-sm">
      <span class="typing-dots"><span></span><span></span><span></span></span>
    </div>`;
  log.appendChild(typing);
  log.scrollTop = log.scrollHeight;

  setTimeout(() => {
    typing.remove();
    appendChatMsg('bot', generateUniversalAIResponse(promptText));
  }, 950);
}

function generateUniversalAIResponse(query) {
  const q = query.toLowerCase();

  if (q.includes('narzo 60') || q.includes('realme')) {
    return `<strong>Realme Hardware Intelligence:</strong><br/>
    Realme Narzo 60 component values are projected to soften by <strong>~12%</strong> over the next 14 days due to new mid-range refresh cycles.<br/>
    • <strong>Top Module:</strong> Main Logic Board (holds 42% of BOM value)<br/>
    • <strong>Recommended Move:</strong> Lock in your quote today for guaranteed doorstep collection.`;
  }
  
  if (q.includes('iphone 15') || q.includes('iphone 14') || q.includes('iphone 13') || q.includes('apple')) {
    return `<strong>Apple Ecosystem Valuation Advisory:</strong><br/>
    Secondary repair demand for Apple OLED panels and A-Series motherboards remains strong. Pre-keynote erosion curves trigger an average <strong>16% drop</strong> within 14 days of Apple announcements.<br/>
    • <strong>Action:</strong> Lock your valuation to avoid the post-announcement flood.`;
  }

  if (q.includes('s24') || q.includes('s23') || q.includes('samsung') || q.includes('galaxy')) {
    return `<strong>Samsung Galaxy Market Trend:</strong><br/>
    Dynamic AMOLED displays and camera modules maintain high repair-market buyback rates. Battery cells older than 2 years drop in salvage pricing.<br/>
    • <strong>Strategy:</strong> Liquidate within the 14-day price lock window.`;
  }

  return `<strong>Hardware Forecast for "${query}":</strong><br/>
  • <strong>Depreciation Rate:</strong> ~1.8% to 2.4% monthly decay based on age &amp; generation.<br/>
  • <strong>High-Yield Modules:</strong> Display panel and motherboard account for >65% of net salvage value.<br/>
  • <strong>Greener India:</strong> ₹5.00 e-waste contribution pledged upon trade.`;
}

function appendChatMsg(sender, html) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  if (sender === 'user') {
    div.className = 'flex justify-end';
    div.innerHTML = `<div class="bubble-user p-3.5 text-xs sm:text-sm max-w-sm rounded-2xl rounded-tr-none shadow-sm">${html}</div>`;
  } else {
    div.className = 'flex items-start gap-2.5 max-w-xl';
    div.innerHTML = `
      <div class="w-8 h-8 rounded-full bg-[#284139] text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="bubble-bot p-4 text-xs sm:text-sm text-slate-800 rounded-2xl rounded-tl-none shadow-sm space-y-1">${html}</div>
    `;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function resetChat() {
  document.getElementById('chat-log').innerHTML = `
    <div class="flex items-start gap-2.5 max-w-xl">
      <div class="w-8 h-8 rounded-full bg-[#284139] text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="bubble-bot p-4 text-xs sm:text-sm text-slate-800 rounded-2xl rounded-tl-none shadow-sm">
        <p>Chat cleared. Ask about any smartphone brand or model depreciation curve.</p>
      </div>
    </div>
  `;
}


/* ── 10. Pickup scheduling, hub location & avatar ──────────────────────── */

function selectPickupDate(btn) {
  document.querySelectorAll('.pickup-date-btn').forEach(b => {
    b.className = 'pickup-date-btn p-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs text-center transition-colors';
  });
  btn.className = 'pickup-date-btn p-2.5 rounded-xl border border-[#284139] bg-teal-50 text-[#284139] font-bold text-xs text-center transition-colors';
}

function confirmPickup() {
  const sel = document.querySelector('.pickup-date-btn.bg-teal-50');
  const day = sel ? sel.textContent.trim().toLowerCase() : 'tomorrow';
  closeModal('pickup-modal');
  toast('Doorstep pickup confirmed for ' + day + '!');
  launchConfetti();
}

function setLoc(name, label) {
  // loc-label lives in My Account, hub-name on the home page — guard both.
  const lbl = document.getElementById('loc-label');
  const hub = document.getElementById('hub-name');
  if (lbl) lbl.textContent = label;
  if (hub) hub.textContent = name;
  closeModal('loc-modal');
  toast('Location Hub updated: ' + name);
}

function previewAvatar(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('prof-avatar-img');
      img.src = e.target.result;
      img.classList.remove('hidden');
      document.getElementById('prof-avatar-icon').classList.add('hidden');
      toast('Profile photo updated');
    };
    reader.readAsDataURL(file);
  }
}

// ─── ANIMATION ENGINE (eye candy, honors prefers-reduced-motion) ───

/* ── 11. Motion, scroll effects & progressive reveal ───────────────────── */

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateCounters() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const render = (n) => { el.textContent = prefix + n.toLocaleString('en-IN') + suffix; };
    if (prefersReducedMotion()) { render(target); return; }
    const t0 = performance.now(), dur = 1400;
    const step = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      render(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function launchConfetti() {
  if (prefersReducedMotion()) return;
  const colors = ['#284139', '#809076', '#F8D794', '#B86830', '#F3C255', '#111A19'];
  for (let i = 0; i < 44; i++) {
    const bit = document.createElement('div');
    bit.className = 'confetti-bit';
    bit.style.left = (Math.random() * 100) + 'vw';
    bit.style.background = colors[Math.floor(Math.random() * colors.length)];
    bit.style.animationDuration = (1.4 + Math.random() * 1.5) + 's';
    bit.style.animationDelay = (Math.random() * 0.35) + 's';
    bit.style.width = (6 + Math.random() * 6) + 'px';
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 3500);
  }
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

// Reveal home sections as they enter the viewport; counters fire with their section
(function initScrollReveal() {
  const blocks = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    blocks.forEach(b => b.classList.add('in-view'));
    animateCounters();
    return;
  }
  const show = (b) => {
    b.dataset.revealed = '1';
    b.classList.add('in-view');
    if (b.id === 'sec-impact') animateCounters();
    io.unobserve(b);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting) show(en.target); });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  blocks.forEach(b => io.observe(b));

  // Blocks sitting on the first screen still have to animate. The old pass ran
  // synchronously during parse — before the first paint and before the Tailwind
  // CDN had injected its stylesheet — so every section measured near y=0 and
  // got .in-view in the same frame it was created, skipping the transition
  // entirely (the Breakdown section, first .reveal on the page, always lost it).
  // Deferring past two frames lets the opacity:0 state paint and the layout
  // settle first; the stagger then resolves the first screen top-down.
  const revealVisible = (stagger) => {
    let i = 0;
    blocks.forEach(b => {
      if (b.dataset.revealed) return;
      if (b.getBoundingClientRect().top >= window.innerHeight * 0.88) return;
      b.dataset.revealed = '1';                 // claim it so a later pass can't jump the queue
      if (stagger) setTimeout(() => show(b), i++ * 140);
      else show(b);
    });
  };

  const firstPass = () => revealVisible(!prefersReducedMotion());
  requestAnimationFrame(() => requestAnimationFrame(firstPass));
  window.addEventListener('load', () => revealVisible(false));
})();

// ── Home ambience ──────────────────────────────────────────────────────────
// The ground warms and cools with the section you are in: green at the
// masthead, through sage and gold, into terracotta, and back to green at the
// close. Each stop carries the two washes for the fixed #ambient layer plus
// the section's own accent pair, so the eyebrows, rules and hairlines travel
// with the ground rather than sitting at a fixed rust against it.
//
//   amb   the two radial washes on the ambient layer
//   acc   saturated hue — rules, marks, the dot rail
//   ink   the same hue shaded far enough to carry 11px bold on ivory
const AMBIENCE = [
  { id: 'sec-hero',     glow: [40, 65, 57, .12], amb: ['#E7EFE7', '#F7F4EB'], acc: '#284139', ink: '#284139' },
  { id: 'sec-worth',    glow: [40, 65, 57, .12], amb: ['#E9F0E7', '#F5F5EC'], acc: '#37574B', ink: '#2E4A3F' },
  { id: 'sec-trust',    glow: [128,144,118, .12], amb: ['#EDF1E4', '#F7F5EA'], acc: '#6A785F', ink: '#55614C' },
  { id: 'sec-impact',   glow: [233,167, 34, .16], amb: ['#FBF0D2', '#F8F3E3'], acc: '#B0740C', ink: '#8D5A0E' },
  { id: 'sec-how',      glow: [233,167, 34, .14], amb: ['#FAECD6', '#F9F1E2'], acc: '#B0740C', ink: '#8D5A0E' },
  { id: 'sec-store',    glow: [184,104, 48, .16], amb: ['#F9E6D6', '#F8EFE4'], acc: '#B86830', ink: '#9C5426' },
  { id: 'sec-activity', glow: [184,104, 48, .12], amb: ['#F3E9DD', '#F2F1E6'], acc: '#9C5426', ink: '#7D411F' },
  { id: 'sec-cta',      glow: [40, 65, 57, .16], amb: ['#E4EDE6', '#F6F4EB'], acc: '#37574B', ink: '#284139' },
  { id: 'sec-contact',  glow: [40, 65, 57, .16], amb: ['#E4EDE6', '#F6F4EB'], acc: '#37574B', ink: '#284139' }
];

const hx = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => {
  const x = hx(a), y = hx(b);
  return '#' + [0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('');
};
const mixGlow = (a, b, t) =>
  `rgba(${[0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)).join(',')},${(a[3] + (b[3] - a[3]) * t).toFixed(3)})`;

// Top progress bar + active section dot on the rail (rAF-throttled: one layout read per frame)
(function initScrollUI() {
  const bar = document.getElementById('scroll-progress');
  const bars = ['site-header', 'mobile-nav'].map(id => document.getElementById(id)).filter(Boolean);
  const dots = Array.from(document.querySelectorAll('.sec-dot'));
  let queued = false;
  let lastY = window.scrollY;
  const measure = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';

    // Top header and bottom mobile bar retract on scroll down and return on
    // scroll up (CSS keeps both to mobile widths). The 6px threshold ignores
    // jitter and rubber-band overscroll; near the top the bars are always shown.
    if (bars.length) {
      const y = Math.max(0, window.scrollY);
      if (Math.abs(y - lastY) > 6) {
        const hide = y > lastY && y > 120;
        bars.forEach(b => b.classList.toggle('nav-hidden', hide));
        lastY = y;
      }
      if (y <= 120) bars.forEach(b => b.classList.remove('nav-hidden'));
    }

    if (S.page !== 'home') {
      // Off the home page the ambience holds at the masthead's colours.
      if (ambKey !== 'off') { ambKey = 'off'; paintAmbience(0, 0); }
      return;
    }

    // Where the sight line falls between two consecutive sections, 0..1.
    // One getBoundingClientRect per section per frame, same budget the dot
    // rail below already pays — the two share this pass rather than each
    // running its own scroll listener.
    const line = window.innerHeight * 0.35;
    const tops = AMBIENCE.map(a => {
      const el = document.getElementById(a.id);
      return el ? el.getBoundingClientRect().top - line : Infinity;
    });
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= 0) i++;
    const span = tops[i + 1] === undefined || !isFinite(tops[i + 1]) ? 0 : tops[i + 1] - tops[i];
    const t = span > 0 ? Math.min(1, Math.max(0, -tops[i] / span)) : 0;

    // Quantised to 1/24 of a step: the eye cannot read finer than that on a
    // wash this soft, and it keeps a full-viewport gradient repaint off all
    // but a few dozen frames of the whole scroll.
    const key = i + ':' + Math.round(t * 24);
    if (key !== ambKey) { ambKey = key; paintAmbience(i, Math.round(t * 24) / 24); }

    if (!dots.length) return;
    let current = dots[0];
    dots.forEach(d => {
      const sec = document.getElementById(d.dataset.sec);
      if (sec && sec.getBoundingClientRect().top <= line) current = d;
    });
    /* The last section is shorter than the sight line is deep, so the page
       runs out of scroll before its top can rise to 35% of the viewport and
       the rail freezes one dot short of the end. It is not a rounding margin
       either: the taller the window the wider the miss, and the rail only
       shows from 1280px up, so tall windows are the common case, not the edge.
       At the foot of the document there is nothing below to point at, so the
       last dot is the answer whatever the sight line says. */
    if (max > 0 && window.scrollY >= max - 2) current = dots[dots.length - 1];
    dots.forEach(d => d.classList.toggle('active', d === current));
  };

  let ambKey = null;
  const root = document.documentElement.style;
  const paintAmbience = (i, t) => {
    const a = AMBIENCE[i], b = AMBIENCE[Math.min(i + 1, AMBIENCE.length - 1)];
    root.setProperty('--amb-a', mixGlow(a.glow, b.glow, t));
    root.setProperty('--amb-b', mix(a.amb[0], b.amb[0], t));
    root.setProperty('--amb-c', mix(a.amb[1], b.amb[1], t));
    root.setProperty('--sec-accent', mix(a.acc, b.acc, t));
    root.setProperty('--sec-ink', mix(a.ink, b.ink, t));
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  measure();
})();

// Cursor-follow 3D tilt on product cards (pointer devices only, one rect read per frame)
(function initCardTilt() {
  if (prefersReducedMotion() || !window.matchMedia('(hover: hover)').matches) return;
  let frame = 0, pending = null;
  const apply = () => {
    frame = 0;
    const p = pending;
    if (!p || !p.card.isConnected) return;
    const r = p.card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = (p.px - r.left) / r.width - 0.5;
    const y = (p.py - r.top) / r.height - 0.5;
    p.card.style.transform = `translateY(-4px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
  };
  document.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.prod-card');
    if (!card) return;
    pending = { card, px: e.clientX, py: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });
  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.prod-card');
    if (card && !card.contains(e.relatedTarget)) {
      if (pending && pending.card === card) pending = null;
      card.style.transform = '';
    }
  });
})();

// Animation budget: looping decor idles off-screen / in a background tab (looks identical when visible)
(function initAnimBudget() {
  if (!('IntersectionObserver' in window)) return;
  // .hero-grad/.blob-* are gone — the masthead's pan now lives on .canopy, and
  // the gilded surfaces loop a gradient of their own.
  const SEL = '.canopy,.bg-pan,.grad-text,.gilt,.gilt-fill,.btn-shine,.float-slow';
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => en.target.classList.toggle('anim-paused', !en.isIntersecting));
  }, { rootMargin: '150px' });
  const watch = () => document.querySelectorAll(SEL).forEach(el => {
    if (el.dataset.animWatched) return;
    el.dataset.animWatched = '1';
    io.observe(el);
  });
  window.watchAnimatedDecor = watch;
  watch();
  document.addEventListener('DOMContentLoaded', watch);
  window.addEventListener('load', watch);
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('anims-hidden', document.hidden);
  });
})();






/* ── The thread ────────────────────────────────────────────────────────────
   A ribbon of parallel strands of - = \ / + laid across the page in long
   passes that run out past one edge and back in at the other, working their
   way down the whole site. One woven cable, wrapped like a line of text.

   ── The path ──────────────────────────────────────────────────────────────
   A pass is a straight tilted run with a shallow wave on it, and pass n sits
   at a fixed pitch below pass n-1:

       screen x = local - OVER                 local runs 0..SPAN
       page   y = Y0 + PITCH*n
                + tilt(n) * (local - SPAN/2)   tilted about its own midpoint
                + a shallow wave

   Two things matter about `tilt`. It is signed, so a little over half the
   passes run downhill to the right and the rest run uphill — without that,
   every pass leans the same way and the page reads as a stack of parallel
   diagonals. And it varies *smoothly* with n (a sine over the pass index), so
   neighbouring passes stay near-parallel even as the tilt swings through zero.
   Tying pitch to tilt instead — chaining each pass onto the end of the last —
   was the obvious construction and the wrong one: a near-flat pass then leaves
   almost no pitch, and measured, two passes came within 1px of each other
   against a 208px-thick band. Holding pitch constant and letting the seam take
   up the difference keeps the closest approach at 284px, and the seam is off
   past the edge of the screen where nobody can see it.

   Nothing above involves time. The excursions off-screen are geometry, not
   animation; the cable holds still under the page as you scroll past it. What
   moves is which character sits at each fixed position: every mark wobbles its
   sampled tangent, so marks near a 45-degree boundary flip between - and \ and
   /, and a ripple of = and + travels along the cable. Measured at ~9% of marks
   changing per tick, with the mix landing near - 42%, \ 19%, / 17%, = 11%,
   + 11%.

   ── Where it is painted ───────────────────────────────────────────────────
     · #glyph-string — a band a little taller than the viewport, absolutely
       positioned in the document at z-index -1, re-anchored when scrolling
       nears its edge. Carries the ribbon over the ivory ground.
     · .glyph-veil — one per .canopy, appended as a child of the canopy.
       Carries the ribbon over the dark emerald bands.

   The veils exist because the canopies win the paint order no matter what:
   they sit at z-index -1 inside a section, and an opaque test fill on a
   body-level z-index -1 canvas is provably painted over by them. A canvas that
   is a *child* of the canopy cannot lose that fight, and it inherits the
   canopy's own mask, so the ribbon ends at the section edge on exactly the
   line the ground does — notched corners included. Each canvas draws only its
   own half, and with no fade left to cross they simply meet: the ink changes
   on the same row of pixels the ground changes on.

   ── Where the budget goes ─────────────────────────────────────────────────
     · Scrolling costs no JavaScript — the band lives in the document and the
       browser scrolls it natively.
     · The marks advance on a ~9fps tick, enough to read as flipping and a
       sixth the cost of doing it every frame. A full redraw measured 2.8ms for
       3522 marks (0.80us each, software raster), and a tick repaints only the
       strip actually on screen rather than the whole band.
     · Off-screen veils are skipped on the tick.
     · Marks sit on a fixed grid of (pass, local), never marched from a canvas
       edge, so a mark's position depends only on where it is in the cable.
       Re-anchoring cannot make the ribbon swim, and the band and the veils
       agree on every position without sharing any state.
     · One path sample per cell serves all eight strands: they are offsets of
       the same chord along its normal and share its tangent.
     · A pass is abandoned as soon as it runs off the right edge, so the
       off-screen part of every pass costs almost nothing.
     · 36 sprites (2 inks x 3 weights x 6 marks) cut once and blitted; fillText
       per mark would re-rasterise a glyph thousands of times.
     · prefers-reduced-motion drops the tick: the cable is then fully static and
       redraws only on re-anchor, resize, or a view switch. */
(function initGlyphString() {
  const band = document.getElementById('glyph-string');
  if (!band || !band.getContext) return;
  const bandCtx = band.getContext('2d');
  if (!bandCtx) return;

  /* 0-3 is the tangent direction, read off the chord angle: flat, leaning
     right, upright, leaning left. 4 and 5 are the accent marks. */
  const GLYPHS = ['-', '\\', '|', '/', '=', '+'];

  /* Two inks, because the ribbon crosses both grounds the page uses — warm
     off-white over the emerald canopies, a burnt umber over the ivory. The
     ivory ground runs gold through the middle sections, and a desaturated
     forest sank into it; the brown is drawn from Egyptian Earth shaded down,
     so it stays a warm sibling of the ground rather than a stain on it.
     Dark-on-light reads heavier than light-on-dark at equal alpha, so the two
     ramps are deliberately not the same numbers. */
  const INK = [
    { rgb: '246,240,220', a: [0.13, 0.26, 0.42] },   // 0 · on the canopies
    { rgb: '124,66,26',   a: [0.16, 0.30, 0.48] }    // 1 · on the ivory ground
  ];

  const TAU  = Math.PI * 2;
  const QUAD = Math.PI / 4;
  const MARGIN = 320;     // band overhang past the viewport, top and bottom
  const Y0     = 90;      // where the cable enters the page
  const OVER   = 0.18;    // overhang each side, as a fraction of viewport width

  const TILT_AMP = 0.20;  // how steeply a pass can lean, either way
  const TILT_K   = 0.62;  // how fast the lean swings from pass to pass
  const WAVE     = 0.020; // shallow undulation on a pass, as a fraction of SPAN
  const WOB      = 0.55;  // how far a mark's sampled angle strays from the path

  /* ── Width tiers ──────────────────────────────────────────────────────
     The cable is (COUNT-1)*gap thick, but the room it has to sit in is
     pitch = span * PITCH_F, and span tracks the viewport. Held at the
     desktop numbers those two converge as the screen narrows: at 390px the
     passes end up 127px apart carrying a 126px cable — 1px of clearance
     against a tilt swing of +/-64px, so consecutive passes run through each
     other and the ribbon collapses into a solid field of characters. The
     cable also takes 32% of the viewport width there, against 12.6% on a
     desktop.

     So each tier scales the cable down *and* opens the pitch, holding the
     two ratios the desktop look is actually built on: gap ~= the glyph box
     (which is what keeps a strand a legible run of marks instead of a
     halftone), and cable thickness ~= 13% of viewport width.

       tier             COUNT  gap  size  cable      clearance
       phone   < 640       5    14     9   56px 14%    167px
       tablet  < 1024      6    19    12   95px 12%    239px
       desktop >= 1024     8    26    16  182px 13%    288px

     The desktop row is the original geometry, unchanged. */
  const WEIGHT_TIERS = {
    5: [0, 1, 2, 1, 0],
    6: [0, 1, 2, 2, 1, 0],
    8: [0, 1, 2, 2, 2, 2, 1, 0]   // bright core, soft edges — the original
  };

  /* Brightness across the ribbon: bright core, soft edges — what makes the
     strands read as one cable with a lit centre rather than N equally
     weighted lines. Indexed by strand. Set with the rest of the tier by
     layout(). */
  let STEP = 26, COUNT = 8, PITCH_F = 0.24, WEIGHT = WEIGHT_TIERS[8];

  let dpr = 1, W = 0, vh = 0, bandH = 0, span = 0, over = 0, pitch = 0, kw = 0;
  let size = 16, spacing = 18, gap = 26, box = 26, half = 13, boxDev = 26;
  let sprites = [];
  let veils = [];                     // { canvas, ctx, top, w, h }
  let dark = [];                      // dark bands, document coords
  let anchor = -1e9, maxAnchor = 0, sig = '';
  let raf = 0, running = true, reduced = false;
  let lastTick = -1e9;
  const born = performance.now();
  const TICK = 110;                   // ms between mark advances

  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  if (mq.addEventListener) mq.addEventListener('change', (e) => { reduced = e.matches; });

  function buildSprites() {
    box  = Math.round(size * 1.6);
    half = box / 2;
    const px = Math.round(box * dpr);
    boxDev = px;
    sprites = [];
    for (let k = 0; k < INK.length; k++) {
      for (let l = 0; l < 3; l++) {
        for (let g = 0; g < GLYPHS.length; g++) {
          const s = document.createElement('canvas');
          s.width = s.height = px;
          const c = s.getContext('2d');
          c.scale(dpr, dpr);
          c.font = '600 ' + size + 'px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = 'rgba(' + INK[k].rgb + ',' + INK[k].a[l] + ')';
          c.fillText(GLYPHS[g], half, half);
          sprites.push(s);
        }
      }
    }
  }

  const sprite = (ink, lvl, g) => sprites[(ink * 3 + lvl) * 6 + g];

  const tiltOf = (n) => TILT_AMP * Math.sin(n * TILT_K + 1.3);
  /* Tilted about the pass midpoint, so changing the tilt pivots a pass rather
     than sliding it into its neighbour. */
  function passY(n, l, m, ph) {
    return Y0 + pitch * n + m * (l - span * 0.5) + span * WAVE * Math.sin(l * kw + ph);
  }

  function syncVeils() {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    veils = [];
    dark = [];
    document.querySelectorAll('.canopy').forEach((el) => {
      let cv = el.querySelector('canvas.glyph-veil');
      if (!cv) {
        cv = document.createElement('canvas');
        cv.className = 'glyph-veil';
        cv.setAttribute('aria-hidden', 'true');
        el.appendChild(cv);
      }
      const r = el.getBoundingClientRect();
      if (r.height < 1 || r.width < 1) { cv.width = cv.height = 0; return; }
      /* The ground no longer fades at either end, so neither does the ink:
         the ribbon changes colour on the same single row of pixels the
         ground does. The fade fields are kept at 0 rather than removed so
         darkness() stays one shape of record. */
      dark.push({
        top: r.top + scrollY,
        bot: r.bottom + scrollY,
        fadeIn:  0,
        fadeOut: 0
      });
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      veils.push({ canvas: cv, ctx: cv.getContext('2d'), top: r.top + scrollY, w: r.width, h: r.height });
    });
  }

  /* 0 over the ivory, 1 over a canopy. The canopies have hard edges, so this
     is a straight switch — the ramp is kept for the case of a fade coming
     back, and costs one branch that is never taken. */
  function darkness(y) {
    for (let i = 0; i < dark.length; i++) {
      const b = dark[i];
      if (y < b.top || y > b.bot) continue;
      if (b.fadeIn  && y < b.top + b.fadeIn)  return (y - b.top) / b.fadeIn;
      if (b.fadeOut && y > b.bot - b.fadeOut) return (b.bot - y) / b.fadeOut;
      return 1;
    }
    return 0;
  }

  /* Draws into ctx, whose top edge is at document y `originY`, every mark
     landing in [yTop, yBot). `wantDark` says whether this is the dark-ground
     surface, which decides the cross-fade weight and which marks are skipped. */
  function paint(ctx, originY, w, h, yTop, yBot, ink, wantDark, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    /* Clear and repaint only the y-window asked for. On a tick that window is
       just what is on screen — 900px of a 1540px band — and the margins keep
       marks from a slightly older tick until the next re-anchor. Positions are
       identical either way, so a strip one tick behind is invisible. */
    const pad = box;
    const cy0 = Math.max(0, Math.floor((yTop - pad - originY) * dpr));
    const cy1 = Math.min(ctx.canvas.height, Math.ceil((yBot + pad - originY) * dpr));
    if (cy1 <= cy0) return;
    ctx.clearRect(0, cy0, ctx.canvas.width, cy1 - cy0);

    const mid   = (COUNT - 1) / 2;
    const bd2   = boxDev >> 1;
    const reach = half + gap * COUNT;
    /* How far a pass can stray from its own centre line — half its tilt across
       the span, plus the wave, plus the ribbon's own half-width. */
    const swing = TILT_AMP * span * 0.5 + span * WAVE + reach;
    const n0 = Math.max(0, Math.floor((yTop - Y0 - swing) / pitch));
    const n1 = Math.ceil((yBot - Y0 + swing) / pitch);

    for (let n = n0; n <= n1; n++) {
      const m  = tiltOf(n);
      const ph = n * 2.1;
      let ya = passY(n, 0, m, ph);

      for (let l = 0; l < span; l += STEP) {
        const lb = Math.min(l + STEP, span);
        const xa = l - over, xb = lb - over;
        const yb = passY(n, lb, m, ph);

        /* x only grows along a pass, so once it is past the right edge the
           rest of the pass is too. */
        if (xa > w + reach) break;
        if (xb < -reach ||
            (ya < yTop - reach && yb < yTop - reach) ||
            (ya > yBot + reach && yb > yBot + reach)) { ya = yb; continue; }

        const dx = xb - xa, dy = yb - ya;
        const len = Math.sqrt(dx * dx + dy * dy);
        const cnt = Math.max(1, Math.round(len / spacing));
        const ang = Math.atan2(dy, dx);
        /* Unit normal to the chord — the offsets that turn one path into eight
           parallel strands. Falls out of `len`, so it costs nothing extra. */
        const nx = -dy / len, ny = dx / len;
        const u  = n * span + l;

        for (let i = 0; i < cnt; i++) {
          const f  = (i + 0.5) / cnt;
          const bx = xa + dx * f;
          const by = ya + dy * f;

          for (let s = 0; s < COUNT; s++) {
            const k = (s - mid) * gap;
            const x = bx + k * nx;
            if (x < -half || x > w + half) continue;
            const yd = by + k * ny;
            if (yd < yTop - half || yd > yBot + half) continue;

            const d = darkness(yd);
            const weight = wantDark ? d : 1 - d;
            if (weight < 0.015) continue;

            /* The chord's own angle, nudged by a slow travelling wobble. Offset
               per strand so the eight do not all turn over at the same moment,
               and large enough that marks cross the 45-degree bins often —
               at 0.30 the mix was 62% dashes, which read as a ruled line. */
            const wob = WOB * Math.sin(u * 0.010 + s * 0.9 - t * 1.6);
            let g = Math.round((ang + wob) / QUAD) & 3;

            /* Accents keyed off u rather than the strand, so they run *across*
               the ribbon and read as bands on a cable; the second term is what
               travels them along it. */
            const acc = Math.sin(u * 0.0042 + 1.1) + 0.5 * Math.sin(u * 0.020 - t * 1.3);
            if (acc > 1.05) g = 4;
            else if (acc < -1.05) g = 5;

            let lvl = WEIGHT[s];
            if (lvl === 2 && Math.sin(u * 0.0026 + t * 0.5) < -0.5) lvl = 1;

            const px = Math.round(x * dpr) - bd2;
            const py = Math.round((yd - originY) * dpr) - bd2;
            if (weight < 0.985) {
              ctx.globalAlpha = weight;
              ctx.drawImage(sprite(ink, lvl, g), px, py);
              ctx.globalAlpha = 1;
            } else {
              ctx.drawImage(sprite(ink, lvl, g), px, py);
            }
          }
        }
        ya = yb;
      }
    }
  }

  /* `full` repaints every surface end to end — used whenever geometry moved.
     A plain tick repaints only the strip in front of the reader. */
  function drawAll(t, full) {
    const sy = window.scrollY || window.pageYOffset || 0;
    const vTop = sy - 40, vBot = sy + vh + 40;

    const bT = full ? anchor : Math.max(anchor, vTop);
    const bB = full ? anchor + bandH : Math.min(anchor + bandH, vBot);
    if (bB > bT) paint(bandCtx, anchor, W, bandH, bT, bB, 1, false, t);

    for (let i = 0; i < veils.length; i++) {
      const v = veils[i];
      if (!v.canvas.width) continue;
      const vT = full ? v.top : Math.max(v.top, vTop);
      const vB = full ? v.top + v.h : Math.min(v.top + v.h, vBot);
      if (vB <= vT) continue;
      paint(v.ctx, v.top, v.w, v.h, vT, vB, 0, true, t);
    }
  }

  /* An absolutely positioned band counts toward the document's scrollable
     height, so it is clamped inside it — otherwise parking it past the last
     section would grow the page, which would let it move down again. */
  function reanchor(scrollY) {
    maxAnchor = Math.max(0, document.documentElement.scrollHeight - bandH);
    anchor = Math.max(0, Math.min(Math.round(scrollY - MARGIN), maxAnchor));
    band.style.top = anchor + 'px';
  }

  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 2 || h < 2) return false;
    /* 1.5x rather than 2x: a decorative layer at a quarter opacity over large
       surfaces — the backing stores are what to spend less on. */
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = w; vh = h;

    /* Tier before geometry: pitch reads PITCH_F and buildSprites() reads
       size. See the tier table above for why each row is what it is. */
    if (w < 640) {
      COUNT = 5; gap = 14; size = 9;  spacing = 10; STEP = 18; PITCH_F = 0.42;
    } else if (w < 1024) {
      COUNT = 6; gap = 19; size = 12; spacing = 13; STEP = 22; PITCH_F = 0.32;
    } else {
      COUNT = 8; gap = 26; size = 16; spacing = 18; STEP = 26; PITCH_F = 0.24;
    }
    WEIGHT = WEIGHT_TIERS[COUNT];

    over  = Math.round(W * OVER);
    span  = W + over * 2;
    pitch = span * PITCH_F;
    kw    = TAU / (span * 0.55);
    bandH = vh + MARGIN * 2;
    band.style.height = bandH + 'px';
    band.width  = Math.round(W * dpr);
    band.height = Math.round(bandH * dpr);
    buildSprites();
    anchor = -1e9;
    return true;
  }

  /* Cheap signature of everything the ribbon's geometry depends on. Catches a
     view switch, a section expanding, fonts landing — anything that moves the
     canopies or changes the page height — without watching for each case. */
  function signature() {
    const docH = document.documentElement.scrollHeight;
    maxAnchor = Math.max(0, docH - bandH);
    let s = window.innerWidth + 'x' + window.innerHeight + ':' + docH;
    document.querySelectorAll('.canopy').forEach((el) => {
      const r = el.getBoundingClientRect();
      s += '|' + Math.round(r.top + (window.scrollY || 0)) + ',' + Math.round(r.height);
    });
    return s;
  }

  let checkAt = 0;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    /* Re-anchor before the viewport reaches the band edge, so the ribbon is
       never missing from a strip of screen — but only when the band still has
       somewhere to go. The clamps matter: at the top of the page the anchor is
       pinned at 0, so a naive `scrollY - 80 < anchor` is true forever and every
       single frame becomes a full redraw. Measured, that was 100k blits in 1.6s
       of sitting still at the top, against about 8k for the ticks alone. */
    let dirty = (anchor > 0 && scrollY - 80 < anchor) ||
                (anchor < maxAnchor && scrollY + vh + 80 > anchor + bandH);

    /* The rest changes rarely and without an event worth binding, so it is
       polled a few times a second instead. */
    if (ts - checkAt > 320) {
      checkAt = ts;
      const s = signature();
      if (s !== sig) { sig = s; dirty = true; }
    }

    const due = !reduced && ts - lastTick >= TICK;
    if (!dirty && !due) return;
    if (due) lastTick = ts;
    /* A plain tick changes no geometry, so it skips the measuring passes. */
    if (dirty) { reanchor(scrollY); syncVeils(); }
    drawAll(reduced ? 0 : (ts - born) / 1000, dirty);
  }

  layout();

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); sig = ''; }, 140);
  });

  /* The sprites bake whatever font resolved when they were cut, so recut once
     JetBrains Mono lands and force a repaint. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { buildSprites(); anchor = -1e9; }).catch(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) anchor = -1e9;
  });

  raf = requestAnimationFrame(frame);
})();

/* ── 8d. Select fields ───────────────────────────────────────────────────
   A native <select>'s option list is browser chrome: it is drawn outside the
   document, so nothing on this page reaches it. It cannot be given the page's
   type, its ivory, its radii or its focus ring, and the OS puts its own arrow
   back over the custom pointer every time one opens. This replaces the list
   with page elements, which fixes all of that at once.

   ── It is an enhancement, not a rewrite of the markup ──────────────────────
   Every <select> stays exactly where it is in the HTML and stays the value of
   record. It is hidden, wrapped, and given a button and a listbox drawn
   beside it; choosing an option writes back to the select and dispatches a
   real `change`, so the inline onchange attributes, updateModels(), the
   quote's val() reads and the contact form all carry on addressing the
   element they always did and never learn any of this happened. Options
   rebuilt from JS — #sel-model is refilled on every brand change — are picked
   up by a MutationObserver, so nothing has to call in here to say so.

   ── Two shapes, one component ──────────────────────────────────────────────
   On a mouse it is a popover under the field, flipping above when the room
   below runs out. On a phone — narrow, or any coarse pointer — it is a bottom
   sheet over a scrim, with the field's own label at the top and rows at a
   thumb-sized 3rem, because a popover anchored to a field halfway up a small
   screen is a worse thing than what it replaced.

   ── Keyboard and assistive tech ────────────────────────────────────────────
   The button is a combobox and the list a listbox, wired with aria-expanded,
   aria-selected and aria-activedescendant. Focus never leaves the button, so
   there is no trap to escape from. Up/Down/Home/End move, Enter and Space
   commit, Escape closes, Tab leaves without committing, and typing jumps to a
   matching option the way the native control does. The hidden select keeps
   the field working for form submission and autofill. */
(function initSelects() {
  const OPEN_H  = 288;   // px of popover before it scrolls, on a mouse
  const TYPE_MS = 700;   // ms a type-ahead buffer survives

  /* Decided per open, not once: a tablet can be rotated and a window can be
     dragged between screens with different pointers. */
  const isSheet = () =>
    window.matchMedia('(max-width: 639px), (pointer: coarse)').matches;

  let uid = 0, live = null;   // the one open widget, if any

  const veil = document.createElement('div');
  veil.className = 'xsel-veil';
  veil.hidden = true;
  document.body.appendChild(veil);

  /* The label to announce. Most fields here label by proximity rather than
     `for`, and the year/month pair shares one label between them, so the
     placeholder option is the last resort — it always reads sensibly
     ("(Choose Brand)", "(Year)"). */
  function labelText(sel, wrap) {
    if (sel.id) {
      const l = document.querySelector('label[for="' + sel.id + '"]');
      if (l) return l.textContent.trim();
    }
    const placeholder = sel.options.length ? sel.options[0].textContent.trim() : 'Select';
    let p = wrap.previousElementSibling;
    if (p && p.tagName === 'LABEL') return p.textContent.trim();
    /* A label one level up belongs to this field only if this field is the
       only one under it. The purchase date is two selects beneath one label,
       and "(Year)" and "(Month)" say far more there than repeating it. */
    p = wrap.parentNode && wrap.parentNode.previousElementSibling;
    if (p && p.tagName === 'LABEL') {
      const kin = wrap.parentNode.querySelectorAll('select').length;
      return kin > 1 ? placeholder : p.textContent.trim();
    }
    return placeholder;
  }

  function enhance(sel) {
    if (sel.dataset.xsel) return;
    sel.dataset.xsel = '1';
    const id = 'xsel' + (++uid);

    const wrap = document.createElement('div');
    wrap.className = 'xsel';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    /* The button inherits the select's own utility classes, so each field
       keeps the size, radius, ground and focus ring it was written with —
       including the contact form's, which is styled for a dark panel. */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xsel-btn ' + sel.className;
    btn.id = id + '-btn';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id + '-list');
    const val = document.createElement('span');
    val.className = 'xsel-val';
    const caret = document.createElement('i');
    caret.className = 'xsel-caret fa-solid fa-chevron-down';
    caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(val);
    btn.appendChild(caret);
    wrap.appendChild(btn);

    const name = labelText(sel, wrap);
    btn.setAttribute('aria-label', name);

    sel.classList.add('xsel-native');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    const pop = document.createElement('div');
    pop.className = 'xsel-pop';
    pop.id = id + '-list';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', name);
    pop.hidden = true;
    const head = document.createElement('p');
    head.className = 'xsel-head';
    head.textContent = name;
    const list = document.createElement('div');
    list.className = 'xsel-list';
    pop.appendChild(head);
    pop.appendChild(list);
    document.body.appendChild(pop);

    let items = [], active = -1, typed = '', typeAt = 0;

    function build() {
      list.textContent = '';
      items = [];
      for (let i = 0; i < sel.options.length; i++) {
        const o = sel.options[i];
        const it = document.createElement('div');
        it.className = 'xsel-opt' + (o.disabled ? ' is-off' : '');
        it.id = id + '-o' + i;
        it.setAttribute('role', 'option');
        it.textContent = o.textContent;
        if (o.disabled) it.setAttribute('aria-disabled', 'true');
        list.appendChild(it);
        items.push(it);
      }
      sync();
    }

    /* The one direction that matters: the select is read, never guessed at.
       Anything that changes it — a click here, updateModels(), a plain
       assignment elsewhere — shows up the next time this runs. */
    function sync() {
      const i = sel.selectedIndex;
      const o = i >= 0 ? sel.options[i] : null;
      val.textContent = o ? o.textContent : '';
      val.classList.toggle('is-empty', !o || !o.value);
      for (let k = 0; k < items.length; k++) {
        items[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      }
    }

    function setActive(i, scroll) {
      if (i < 0 || i >= items.length) return;
      if (active >= 0 && items[active]) items[active].classList.remove('is-on');
      active = i;
      items[i].classList.add('is-on');
      btn.setAttribute('aria-activedescendant', items[i].id);
      if (scroll) items[i].scrollIntoView({ block: 'nearest' });
    }

    function step(from, dir) {
      for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
        if (!sel.options[i].disabled) return i;
      }
      return -1;
    }

    function place() {
      const r = btn.getBoundingClientRect();
      pop.style.maxHeight = '';
      pop.style.minWidth = Math.round(r.width) + 'px';
      const w = pop.offsetWidth;
      pop.style.left = Math.round(
        Math.max(8, Math.min(r.left, window.innerWidth - 8 - w))) + 'px';
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const want  = Math.min(pop.scrollHeight, OPEN_H);
      /* Below unless it does not fit and there is more room above — the flip
         is a fallback, not a preference, so fields near the fold stay
         predictable. */
      if (want > below && above > below) {
        pop.style.maxHeight = Math.min(want, above) + 'px';
        pop.style.top = Math.round(r.top - Math.min(want, above) - 6) + 'px';
      } else {
        pop.style.maxHeight = Math.min(want, below) + 'px';
        pop.style.top = Math.round(r.bottom + 6) + 'px';
      }
    }

    function open() {
      if (live === api) return;
      if (live) live.close();
      live = api;

      const sheet = isSheet();
      pop.classList.toggle('is-sheet', sheet);
      pop.hidden = false;
      if (sheet) {
        pop.style.cssText = '';           // the sheet is placed entirely in CSS
        veil.hidden = false;
        document.body.classList.add('xsel-locked');
      } else {
        place();
      }
      requestAnimationFrame(function () {
        if (live === api) pop.classList.add('is-open');
      });
      btn.setAttribute('aria-expanded', 'true');

      const start = sel.selectedIndex >= 0 && !sel.options[sel.selectedIndex].disabled
        ? sel.selectedIndex : step(-1, 1);
      if (start >= 0) setActive(start, true);
    }

    function close(refocus) {
      if (live !== api) return;
      live = null;
      pop.classList.remove('is-open');
      pop.hidden = true;
      veil.hidden = true;
      document.body.classList.remove('xsel-locked');
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      if (refocus) btn.focus();
    }

    function pick(i) {
      if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
      const changed = sel.selectedIndex !== i;
      sel.selectedIndex = i;
      sync();
      close(true);
      /* A real, bubbling change: the inline onchange attributes on these
         fields are listening for exactly this and cannot tell the difference
         from a native one. */
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function typeahead(ch) {
      const now = Date.now();
      typed = (now - typeAt > TYPE_MS ? '' : typed) + ch.toLowerCase();
      typeAt = now;
      /* One character starts from the option after the active one, so
         pressing the same letter cycles; more than one refines in place, so
         "sam" does not walk off the Samsung it just found. */
      const from = (active < 0 ? 0 : active) + (typed.length > 1 ? 0 : 1);
      for (let n = 0; n < items.length; n++) {
        const i = (from + n + items.length) % items.length;
        if (sel.options[i].disabled) continue;
        if (sel.options[i].textContent.trim().toLowerCase().indexOf(typed) === 0) {
          setActive(i, true);
          return;
        }
      }
    }

    btn.addEventListener('click', () => { live === api ? close(false) : open(); });

    btn.addEventListener('keydown', e => {
      const k = e.key;
      if (live !== api) {
        if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || k === 'Spacebar') {
          e.preventDefault(); open();
        } else if (k.length === 1) {
          open(); typeahead(k);
        }
        return;
      }
      if (k === 'Escape')            { e.preventDefault(); close(true); }
      else if (k === 'Tab')          { close(false); }
      else if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); pick(active); }
      else if (k === 'ArrowDown')    { e.preventDefault(); const i = step(active, 1);  if (i >= 0) setActive(i, true); }
      else if (k === 'ArrowUp')      { e.preventDefault(); const i = step(active, -1); if (i >= 0) setActive(i, true); }
      else if (k === 'Home')         { e.preventDefault(); const i = step(-1, 1); if (i >= 0) setActive(i, true); }
      else if (k === 'End')          { e.preventDefault(); const i = step(items.length, -1); if (i >= 0) setActive(i, true); }
      else if (k.length === 1)       { typeahead(k); }
    });

    /* Delegated, so a rebuilt list needs no handlers re-attached. */
    list.addEventListener('click', e => {
      const it = e.target.closest('.xsel-opt');
      if (it) pick(items.indexOf(it));
    });
    list.addEventListener('pointermove', e => {
      const it = e.target.closest('.xsel-opt');
      if (it && !it.classList.contains('is-off')) setActive(items.indexOf(it), false);
    }, { passive: true });

    /* #sel-model is refilled every time the brand changes, and the year and
       month lists could be too. Watching the select means none of that code
       has to know this component exists. */
    new MutationObserver(build).observe(sel, { childList: true, subtree: true });
    sel.addEventListener('change', sync);

    const api = { close: close, place: place, sheet: () => pop.classList.contains('is-sheet') };
    pop.__xsel = api; btn.__xsel = api;
    build();
  }

  /* One listener for every widget rather than one each. A press inside the
     button or its list is that widget's business; anywhere else closes. */
  document.addEventListener('pointerdown', e => {
    if (!live) return;
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.xsel-pop') || e.target.closest('.xsel-btn')) return;
    live.close(false);
  }, true);
  veil.addEventListener('click', () => { if (live) live.close(false); });

  /* The popover is anchored to a field that scrolls; the sheet is not, and
     the page under it is locked anyway. */
  window.addEventListener('scroll', () => {
    if (live && !live.sheet()) live.place();
  }, { passive: true });
  window.addEventListener('resize', () => { if (live) live.close(false); });

  document.querySelectorAll('select').forEach(enhance);
})();

/* ── The cursor grid ────────────────────────────────────────────────────────
   An imaginary dot matrix laid over the page. Nothing of it is drawn: the
   lattice is a rule about where a dot *would* be, and the pointer is the only
   thing that ever lights any of them. A dot too faint to read is not drawn at
   all, so the grid has no resting state to see.

   ── The ramp ───────────────────────────────────────────────────────────────
   Brightness is a function of one thing: how far the dot is from the pointer.
   Nearest is the strongest ink, all but opaque; each step out is weaker,
   thinner and smaller, and by the outer radius there is nothing left. The
   dots do not animate — they do not pulse, flicker or ease. A dot's colour
   depends on where the pointer is and on nothing else, so the only thing that
   ever moves on the page is the pointer itself.

   Inside INNER there is nothing at all, which is the hole the pointer's own
   brown disc sits in. Without it the pointer would sit in the darkest part of
   the ramp with dots showing through and around it.

   ── Two grounds, two ramps ─────────────────────────────────────────────────
   Brown ink is only brown against the ivory. On the emerald canopies the dark
   end of the ramp is the same value as the ground and vanishes, so the dark
   grounds get their own ramp, running the other way: near-white khaki at the
   pointer, thinning to a brown that dies into the green. Both read as ink
   that is strongest under the cursor and gone by the rim, which is the point;
   only the direction of the value flips.

   ── One canvas per ground ──────────────────────────────────────────────────
   Which ramp a dot gets is not decided in JS. There is a canvas for the ivory
   fixed to the viewport, and one more inside each .canopy — and a canopy is a
   stacking context that paints its background under its own children, so the
   canopy's canvas lands on top of the green while the ivory's canvas is
   hidden behind it. Each ground therefore shows exactly its own ramp, the
   seam between them falls on the canopy's own mask (notched corners
   included), and nothing has to know where the boundary is.

   This is the same move #glyph-string makes, and for the same reason: a
   negative z-index layer at body level cannot get above the canopies, because
   .view.on carries a transform and so traps everything inside it — the ivory
   canvas is behind the whole view, not merely behind its text.

   ── The lattice is fixed, the light is not ─────────────────────────────────
   The dots belong to the page, not to the cursor: their positions are whole
   multiples of GRID in viewport space, so moving the mouse lights different
   dots rather than dragging the same ones along. This is the whole reason it
   reads as a matrix being revealed instead of a sprite being moved, and it is
   why a canvas is repositioned only in the same breath as it is redrawn — a
   transform applied on its own would carry the lattice with it. Every canvas
   works from the same viewport-space lattice, so the dots line up across a
   seam without either side knowing about the other.

   ── Where the budget goes ──────────────────────────────────────────────────
     · There is no loop. A move schedules one frame, that frame draws, and
       that is the end of it: a still pointer costs nothing, with no timer
       running and no rAF pending.
     · ~90 dots per canvas, blitted from 6 pre-cut sprites per ramp. No arcs,
       no gradients, no per-dot state — distance in, sprite out.
     · A canopy canvas is only drawn while the pool actually overlaps it, and
       cleared once as it leaves, so most of the page costs one canvas.
     · Canopy rectangles are cached and re-read at most once a frame, and only
       after a scroll or a resize says they moved.
     · Pointer devices only, and off under prefers-reduced-motion — the same
       gate the card tilt uses. */
(function initCursorGrid() {
  if (prefersReducedMotion()) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  /* Six steps out from the pointer, strongest first. Colour, alpha and radius
     all move together: a ramp that only faded would read as one dot at six
     strengths, where this reads as ink thinning out.

     On the ivory the middle of the ramp is --earth, the same brown the
     pointer disc is drawn in. On the green it is the khaki the canopy already
     gilds itself with, so neither ramp introduces a colour the page does not
     already use. */
  const INK_LIGHT = [
    { c: '92,46,16',    a: 0.88, r: 2.10 },   // deep espresso, at the hole
    { c: '122,63,23',   a: 0.72, r: 1.85 },
    { c: '154,84,35',   a: 0.56, r: 1.60 },
    { c: '184,104,48',  a: 0.42, r: 1.35 },   // --earth
    { c: '201,138,82',  a: 0.28, r: 1.10 },
    { c: '214,168,120', a: 0.16, r: 0.85 }    // last thing before nothing
  ];
  const INK_DARK = [
    { c: '250,240,214', a: 0.82, r: 2.10 },   // near-white khaki, at the hole
    { c: '248,215,148', a: 0.66, r: 1.85 },   // --khaki
    { c: '226,176,106', a: 0.52, r: 1.60 },
    { c: '201,138,82',  a: 0.40, r: 1.35 },
    { c: '176,110,62',  a: 0.28, r: 1.10 },
    { c: '150,90,48',   a: 0.17, r: 0.85 }    // dies into the green
  ];

  const R     = 88;   // outer edge of the pool — past this nothing is lit
  const INNER = 22;   // the hole the pointer sits in; nothing inside it.
                      // Clears the pointer disc at its widest: 26px across,
                      // scaled to 1.55 over a control, so 20px of radius.
  const GRID  = 16;   // lattice pitch, viewport px
  const HALF  = 94;   // half the canvas box: R plus room for the last sprite
  const SPAN  = HALF * 2;
  const IDLE  = 1700; // ms of stillness before the pool fades out
  const REACH = R - INNER;

  /* One ground per canvas. The first is the page itself; the rest are the
     dark canopies, each holding its own canvas so the canopy's mask and
     overflow clip the pool to the ground it belongs to. */
  const grounds = [];

  function addGround(host, ink, fixed) {
    const cv = document.createElement('canvas');
    cv.className = fixed ? 'cursor-grid' : 'cursor-grid cursor-grid-veil';
    cv.setAttribute('aria-hidden', 'true');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    host.appendChild(cv);
    grounds.push({ el: cv, ctx: ctx, ink: ink, host: fixed ? null : host,
                   view: fixed ? null : host.closest('.view'),
                   sprites: [], drew: false, freed: false });
  }

  addGround(document.body, INK_LIGHT, true);
  document.querySelectorAll('.canopy').forEach(function (c) {
    addGround(c, INK_DARK, false);
  });
  if (!grounds.length) return;

  let dpr = 0, box = 8, half = 4;

  /* Sizing is split out from sprite building because a ground whose backing
     store has been released needs one back before it can be drawn into
     again — see release(). Setting width/height also clears the canvas, so
     `drew` resets with it. */
  function sizeGround(g) {
    g.el.style.width  = SPAN + 'px';
    g.el.style.height = SPAN + 'px';
    g.el.width  = Math.round(SPAN * dpr);
    g.el.height = Math.round(SPAN * dpr);
    g.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drew = false;
    g.freed = false;
  }

  /* Drop a ground's pixels rather than merely clearing them. A 188px box at
     dpr 2 is ~566KB of backing store, and a veil sitting in a view nobody is
     looking at — or under an opaque dialog — has no reason to hold one.
     Zeroing the canvas frees it; sizeGround() hands it back on the first
     frame the ground is actually wanted again. The sprites are separate
     little canvases and stay valid throughout, so coming back is cheap. */
  function release(g) {
    if (g.freed) return;
    g.el.width = g.el.height = 0;
    g.drew = false;
    g.freed = true;
  }

  function buildSprites() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    grounds.forEach(function (g) {
      sizeGround(g);
      g.sprites = g.ink.map(function (step) {
        const s = document.createElement('canvas');
        s.width = s.height = Math.round(box * dpr);
        const c = s.getContext('2d');
        c.scale(dpr, dpr);
        c.fillStyle = 'rgba(' + step.c + ',' + step.a + ')';
        c.beginPath();
        c.arc(half, half, step.r, 0, Math.PI * 2);
        c.fill();
        return s;
      });
    });
  }

  /* ox, oy are the canvas's top-left in viewport px and are whole numbers, so
     a lattice point at i*GRID lands on the same canvas pixel however the
     canvas has been placed — which is what keeps the dots still, and what
     keeps two grounds' dots on one lattice. cx, cy are the pointer inside
     that box. */
  function draw(g, ox, oy, cx, cy) {
    const ctx = g.ctx;
    ctx.clearRect(0, 0, SPAN, SPAN);

    const i0 = Math.ceil(ox / GRID), i1 = Math.floor((ox + SPAN) / GRID);
    const j0 = Math.ceil(oy / GRID), j1 = Math.floor((oy + SPAN) / GRID);

    for (let i = i0; i <= i1; i++) {
      const px = i * GRID - ox;
      const dx = px - cx;
      if (dx < -R || dx > R) continue;
      for (let j = j0; j <= j1; j++) {
        const py = j * GRID - oy;
        const dy = py - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < INNER || d > R) continue;
        /* Distance straight to a step. Anything past the last one has already
           been excluded by the radius test, so there is no faint tail of dots
           left over outside the pool. */
        const step = ((d - INNER) / REACH * g.ink.length) | 0;
        ctx.drawImage(g.sprites[step], px - half, py - half, box, box);
      }
    }
    g.drew = true;
  }

  let tx = 0, ty = 0, raf = 0, idle = 0, on = false;

  /* Under a dialog the pool is painted beneath an opaque sheet: every dot is
     invisible by construction, and the pointer is over the dialog rather than
     the page anyway. The overlays are static in the markup, so the list is
     read once and only a class is tested from here on — no query and no
     layout on a path that runs per pointermove. .xsel-locked is the custom
     select's sheet, which covers the page the same way. */
  const overlays = Array.prototype.slice.call(document.querySelectorAll('.overlay'));
  function covered() {
    if (document.body.classList.contains('xsel-locked')) return true;
    for (let i = 0; i < overlays.length; i++) {
      if (overlays[i].classList.contains('open')) return true;
    }
    return false;
  }

  /* dismiss() is the light going out — the class comes off and the pixels
     stay. This is the layer going away: pixels and backing stores both. */
  function unload() {
    dismiss();
    grounds.forEach(release);
  }

  /* One frame per move, coalesced: several pointermove events inside a frame
     schedule a single paint, and nothing is scheduled at all once the pointer
     stops. */
  function paint() {
    raf = 0;
    if (covered()) { unload(); return; }

    const ox = Math.round(tx - HALF), oy = Math.round(ty - HALF);
    const cx = tx - ox, cy = ty - oy;

    // The page's own canvas is fixed, so it is placed in viewport coordinates.
    if (grounds[0].freed) sizeGround(grounds[0]);
    grounds[0].el.style.transform =
      'translate3d(' + ox + 'px,' + oy + 'px,0)';
    draw(grounds[0], ox, oy, cx, cy);

    for (let i = 1; i < grounds.length; i++) {
      const g = grounds[i];
      /* Measured here, every frame, rather than cached against scroll and
         resize. A canopy moves and resizes for reasons no event reports: a
         reveal transition growing the section above it, a view switch, a font
         or image landing, the closing panel following the content between it
         and the fold. Caching it produced exactly the three faults it looked
         like it would — a rectangle a hundred pixels out of date put the pool
         that far off the cursor, one measured while its view was hidden stayed
         at zero width and the pool never appeared over the green at all, and
         anything in between made it flicker as the two disagreed. Two reads a
         frame, only while the pointer is moving, is what it costs to always be
         right. */
      /* Except when the veil's view is not the one on screen. Its host then
         measures as a zero rect and the overlap test below rejects it — but
         only after a forced layout read, per canopy, per frame. The class
         says the same thing for free, so while the reader is on another tab
         the read never happens and the veil gives its pixels back. */
      if (g.view && !g.view.classList.contains('on')) { release(g); continue; }
      const r = g.host.getBoundingClientRect();
      /* A canopy the pool does not reach is left alone — but it is cleared
         once on the way out, or it would keep the last dots it drew. A hidden
         view measures as a zero rect, which fails this test. */
      const over = r.width && r.height &&
                   ox < r.right && ox + SPAN > r.left &&
                   oy < r.bottom && oy + SPAN > r.top;
      if (!over) {
        if (g.drew) { g.ctx.clearRect(0, 0, SPAN, SPAN); g.drew = false; }
        continue;
      }
      /* Absolute inside the canopy, so the placement is the same viewport
         position expressed against the canopy's own origin. Deliberately not
         rounded: .canopy is centred with left:50% and a translate, so on an
         odd viewport width its own left edge falls on a half pixel. Rounding
         here would land the canvas half a pixel off the lattice its dots were
         drawn for; carrying the fraction through puts the canvas origin back
         on the whole viewport pixel the lattice assumes, which is also the
         one the page's own canvas is using. */
      if (g.freed) sizeGround(g);
      g.el.style.transform = 'translate3d(' +
        (ox - r.left).toFixed(2) + 'px,' + (oy - r.top).toFixed(2) + 'px,0)';
      draw(g, ox, oy, cx, cy);
    }
  }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    if (covered()) { if (on) unload(); return; }
    tx = e.clientX; ty = e.clientY;
    if (!on) {
      on = true;
      grounds.forEach(function (g) { g.el.classList.add('on'); });
    }
    clearTimeout(idle);
    idle = setTimeout(dismiss, IDLE);
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });

  /* Off the window, into a background tab, or simply left alone: drop it
     rather than leaving a pool of light parked where the pointer was. */
  function dismiss() {
    clearTimeout(idle);
    if (!on) return;
    on = false;
    grounds.forEach(function (g) { g.el.classList.remove('on'); });
  }
  function revive() {
    if (on || covered()) return;
    on = true;
    grounds.forEach(function (g) { g.el.classList.add('on'); });
    clearTimeout(idle);
    idle = setTimeout(dismiss, IDLE);
  }
  document.addEventListener('mouseleave', dismiss);
  window.addEventListener('blur', dismiss);
  document.addEventListener('visibilitychange', function () { if (document.hidden) unload(); });

  /* A native <select> popup is browser chrome, not page content: the OS draws
     its own arrow over it whatever this page says about `cursor`, and there is
     no way to reach it. So while one is up, stand down — otherwise the arrow
     and a frozen pool sit on screen together, which is worse than either
     alone. The page receives no pointermove while the popup has the mouse, so
     the first move after it closes brings it back; the change that closes it
     does too, for the case where the pointer never moves again. */
  document.addEventListener('mousedown', function (e) {
    if (e.target && e.target.tagName === 'SELECT') dismiss();
  }, true);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.tagName === 'SELECT') revive();
  }, true);

  let rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(buildSprites, 140);   // only the device pixel ratio matters
  });

  buildSprites();
})();
/* ── The pointer ────────────────────────────────────────────────────────────
   The arrow is replaced by a brown disc, iPadOS-style: a tinted fill in a
   firmer ring, trailing the pointer by a few frames, swelling when it is over
   something that can be clicked and narrowing to a bar over text.

   The native cursor is only hidden once this element exists — the
   .cursor-dot-on class goes on <html> from here, so a touchscreen, a blocked
   script or an early return all leave the real cursor alone rather than
   leaving the page with no pointer at all.

   Cost is a transform per frame while the disc is catching up and nothing at
   all once it has: the loop ends the moment the gap closes, and the state
   changes ride on pointerover/pointerdown, which fire on crossings rather
   than on movement. The shape itself animates in CSS. */
(function initCursorDot() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const HALF = 13;                                 // half of the 26px box
  /* The lag is the whole character of the thing, but it is also motion the
     pointer did not ask for, so under reduced-motion the disc is simply
     pinned to the cursor. */
  const EASE = prefersReducedMotion() ? 1 : 0.3;

  const HOT  = 'a,button,summary,label,select,[role="button"],[role="tab"],' +
               '[role="option"],[onclick],.brand-pill,.sec-dot,.mode-pill button';
  const BEAM = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
               ':not([type="submit"]):not([type="button"]),textarea,[contenteditable="true"]';

  const el = document.createElement('div');
  el.id = 'cursor-dot';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  document.documentElement.classList.add('cursor-dot-on');

  let x = 0, y = 0, tx = 0, ty = 0;
  let placed = false, raf = 0, on = false, hot = false, beam = false;

  function frame() {
    x += (tx - x) * EASE;
    y += (ty - y) * EASE;
    const dx = tx - x, dy = ty - y;
    /* Within a twentieth of a pixel there is nothing left to show, so the
       loop stops rather than easing forever toward the cursor. */
    const done = dx * dx + dy * dy < 0.05;
    if (done) { x = tx; y = ty; }
    el.style.transform =
      'translate3d(' + (x - HALF).toFixed(1) + 'px,' + (y - HALF).toFixed(1) + 'px,0)';
    raf = done ? 0 : requestAnimationFrame(frame);
  }

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    tx = e.clientX; ty = e.clientY;
    if (!placed) { placed = true; x = tx; y = ty; }   // no flight in from 0,0
    if (!on) { on = true; el.classList.add('on'); }
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });

  /* pointerover fires once per element crossing, not per move, so the two
     closest() walks here cost far less than they look like they do. */
  document.addEventListener('pointerover', function (e) {
    const t = e.target;
    const isEl = t && t.nodeType === 1;
    const h = isEl && !!t.closest(HOT);
    const b = isEl && !!t.closest(BEAM);
    if (h !== hot)  { hot  = h; el.classList.toggle('hot', h); }
    if (b !== beam) { beam = b; el.classList.toggle('beam', b); }
  }, { passive: true });

  document.addEventListener('pointerdown', function () { el.classList.add('down'); }, { passive: true });
  document.addEventListener('pointerup',   function () { el.classList.remove('down'); }, { passive: true });

  /* Off the window: hide it, and drop the pressed state with it — a
     pointerup that lands outside never reaches us. */
  function dismiss() {
    if (on) { on = false; el.classList.remove('on'); }
    el.classList.remove('down');
  }
  function revive() {
    if (!on) { on = true; el.classList.add('on'); }
  }
  document.addEventListener('mouseleave', dismiss);
  window.addEventListener('blur', dismiss);

  /* A native <select> popup is browser chrome, not page content: the OS draws
     its own arrow over it whatever this page says about `cursor`, and there is
     no way to reach it. So while one is up, stand down — otherwise the arrow
     and a frozen disc sit on screen together, which is worse than either
     alone. The page receives no pointermove while the popup has the mouse, so
     the first move after it closes brings it back; the change that closes it
     does too, for the case where the pointer never moves again. */
  document.addEventListener('mousedown', function (e) {
    if (e.target && e.target.tagName === 'SELECT') dismiss();
  }, true);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.tagName === 'SELECT') revive();
  }, true);
})();

// ─── INITIALIZATION ON EVERY PAGE REFRESH ───
document.addEventListener('DOMContentLoaded', () => {
  const existingUser = window.DB.get('user', null);
  if (!existingUser || !existingUser.isLoggedIn) {
    window.setCleanDefaultState();
  } else {
    renderDatabaseUI();
  }
  
  updateModels();
  renderShop('dev', 'all');

  // Upgrades the Sell tab's teardown to WebGL when three.js and the GPU allow
  // it; a false return just leaves the SVG teardown in place.
  Teardown3D.init();

  // ALWAYS RESET SELL & DISASSEMBLE TO CLEAN DEFAULT ON REFRESH
  resetSellAndDisassembleToDefault();
});

/* ═══════════════════════════════════════════════════════════════════════════
   12. FIREBASE AUTHENTICATION BOOTSTRAP
   ───────────────────────────────────────────────────────────────────────────
   The Firebase v10 SDK ships as ES modules only, so it is loaded with dynamic
   import() rather than a static `import` statement — that keeps this file a
   classic script and keeps every function above global for the inline
   onclick handlers in index.html.

   Runs after the synchronous body of this file, so window.toast(),
   window.DB, window.setCleanDefaultState() and the
   window.handleFirebaseUser* callbacks all exist by the time the auth state
   listener can fire.
   ═══════════════════════════════════════════════════════════════════════════ */
(async function initFirebaseAuth() {
  const FB = "https://www.gstatic.com/firebasejs/10.12.2";
  let initializeApp, getAnalytics, getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged;

  try {
    ({ initializeApp }  = await import(`${FB}/firebase-app.js`));
    ({ getAnalytics }   = await import(`${FB}/firebase-analytics.js`));
    ({ getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
                        = await import(`${FB}/firebase-auth.js`));
  } catch (e) {
    // Offline / CDN blocked — the app still works with local guest state.
    console.warn("Firebase SDK could not be loaded; continuing in local-only mode.", e);
    return;
  }

  // Your web app's Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyBamZiZ5GhrwdZ0qLxPYK9YfV5K904ySkk",
    authDomain: "resell-123.firebaseapp.com",
    projectId: "resell-123",
    storageBucket: "resell-123.firebasestorage.app",
    messagingSenderId: "862001352556",
    appId: "1:862001352556:web:8f245b0a19e31d4b70ad49",
    measurementId: "G-7KWHPMGMW3"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  let analytics = null;
  try {
    analytics = getAnalytics(app);
  } catch (e) {
    console.warn("Firebase analytics not supported in this environment");
  }

  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // Expose to window for global access
  window.FirebaseAuth = {
    auth,
    provider,
    signInWithGoogle: async () => {
      try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        window.handleFirebaseUserLogin(user);
        return user;
      } catch (error) {
        console.error("Firebase Google Auth Error:", error);
        if (error.code === 'auth/unauthorized-domain' || error.code === 'auth/popup-closed-by-user' || error.code === 'auth/configuration-not-found') {
          window.handleFirebaseAuthFallback(error);
        } else {
          window.toast("Auth error: " + error.message);
        }
        throw error;
      }
    },
    signOutUser: async () => {
      try {
        await signOut(auth);
        window.handleFirebaseUserLogout();
      } catch (error) {
        console.error("Firebase SignOut Error:", error);
      }
    }
  };

  // Listen to Auth State Changes
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.handleFirebaseUserLogin(user);
    } else {
      const existingUser = window.DB ? window.DB.get('user', null) : null;
      if (!existingUser || !existingUser.isLoggedIn) {
        window.setCleanDefaultState();
      }
    }
  });
})();
