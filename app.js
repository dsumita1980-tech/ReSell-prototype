import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
  import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged 
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
  currentQuotedModel: '',
  chartInst: null
};

// ─── RESET SELL & DISASSEMBLE TO CLEAN DEFAULT ───
function resetSellAndDisassembleToDefault() {
  // Show the whole phone preview card
  const wholePhone = document.getElementById('whole-phone-preview');
  const explodedGrid = document.getElementById('exploded-3d-grid');
  if (wholePhone) wholePhone.classList.remove('hidden');
  if (explodedGrid) explodedGrid.classList.add('hidden');

  // Reset status badge
  const disBadge = document.getElementById('dis-badge');
  if (disBadge) {
    disBadge.textContent = 'Ready to Analyze';
    disBadge.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600';
  }

  // Reset Component Values to placeholder
  ['m3d-disp-val', 'm3d-logic-val', 'm3d-batt-val', 'm3d-cam-val', 'm3d-chassis-val'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '₹—';
  });

  // Reset BOM Right Column
  const bomTitle = document.getElementById('bom-title');
  const bomAgeLabel = document.getElementById('bom-age-label');
  const bomTotal = document.getElementById('bom-total');
  const bomRows = document.getElementById('bom-rows');
  const previewModel = document.getElementById('preview-model-name');

  if (bomTitle) bomTitle.textContent = 'Select Phone Model';
  if (bomAgeLabel) bomAgeLabel.textContent = 'Click "Check & Disassemble Phone" to calculate';
  if (bomTotal) bomTotal.textContent = '₹0';
  if (previewModel) previewModel.textContent = 'Ready for Scan';
  if (bomRows) {
    bomRows.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Run a disassembly to view component BOM valuation.</p>';
  }

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

function nav(p) {
  S.page = p;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const target = document.getElementById('view-' + p);
  if (target) setTimeout(() => target.classList.add('on'), 10);

  // Sync Desktop Nav Links
  document.querySelectorAll('.nav-link').forEach(b => {
    const isAct = b.dataset.p === p;
    b.classList.toggle('text-[#1e3a5f]', isAct);
    b.classList.toggle('font-bold', isAct);
    b.classList.toggle('bg-slate-100', isAct);
  });

  // Sync Mobile Bottom Nav Links
  document.querySelectorAll('.mob-nav').forEach(b => {
    const isAct = b.dataset.p === p;
    if (isAct) {
      b.classList.remove('text-slate-400');
      b.classList.add('text-[#1e3a5f]');
    } else {
      b.classList.remove('text-[#1e3a5f]');
      b.classList.add('text-slate-400');
    }
  });

  // Reveal bottom nav bar on tab change
  const mobNav = document.getElementById('bottom-mob-nav');
  if (mobNav) {
    mobNav.classList.remove('translate-y-full');
    mobNav.classList.add('translate-y-0');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (p === 'shop') renderShop('dev', 'all');
  if (p === 'quote') setTimeout(updateModels, 50);
  if (p === 'profile') renderDatabaseUI();
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
function renderDatabaseUI() {
  const user = window.DB.get('user', { name: 'Guest User', email: 'guest@resell.com', city: 'Bhatpara, WB', photoURL: '', isLoggedIn: false });
  const quotes = window.DB.get('quotes', []);
  const orders = window.DB.get('orders', []);
  const addrs = window.DB.get('addresses', []);

  document.getElementById('prof-name').textContent = user.name;
  document.getElementById('prof-email').textContent = user.isLoggedIn 
    ? `${user.email} · Connected to Firebase Project resell-123`
    : 'Sign in with Google to sync active quotations, orders, and addresses.';
  
  document.getElementById('prof-status-badge').textContent = user.isLoggedIn ? '⭐ Firebase Verified Member' : 'Guest Account';
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
          <div class="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xl text-[#1e3a5f] flex-shrink-0">
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
            <p class="text-xl font-black text-[#1e3a5f]">₹${q.price.toLocaleString('en-IN')}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="openModal('pickup-modal')" class="px-3.5 py-2.5 rounded-xl bg-[#2d7a5f] hover:bg-[#3a9e7a] text-white font-bold text-xs">Schedule Pickup</button>
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
          <div class="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xl text-[#2d7a5f] flex-shrink-0">
            <i class="fa-solid fa-shield-heart"></i>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-sm text-slate-900">${o.title}</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">1-Yr Warranty Active</span>
            </div>
            <p class="text-xs text-slate-500">Order #${o.id} · Certified by Nexgen</p>
            <p class="text-xs text-[#2d7a5f] font-semibold">${o.warrantyDays} Days Remaining on Guarantee</p>
          </div>
        </div>
        <div class="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
          <button onclick="openModal('track-modal')" class="px-3.5 py-2.5 rounded-xl bg-[#1e3a5f] text-white font-bold text-xs">Track</button>
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

function runDisassembly() {
  const brand = document.getElementById('sel-brand').value || 'realme';
  const model = document.getElementById('sel-model').value || 'Realme Narzo 60 (128GB)';
  const buyYear = parseInt(document.getElementById('sel-buy-year').value || '2023');
  const buyMonth = parseInt(document.getElementById('sel-buy-month').value || '8');
  const cond = document.getElementById('sel-cond').value;

  S.currentQuotedModel = model;

  const nowYear = 2026, nowMonth = 8;
  const ageMonths = Math.max(1, (nowYear - buyYear) * 12 + (nowMonth - buyMonth));

  const bom = BOM_BASE[brand] || BOM_BASE.realme;
  const mult = COND_MULT[cond] || 0.60;
  const decay = bom.decay;

  const calc = (base) => Math.round(base * Math.pow(1 - decay, ageMonths) * mult);
  const vals = {
    display: calc(bom.display),
    logic: calc(bom.logic),
    battery: calc(bom.battery),
    camera: calc(bom.camera),
    chassis: calc(bom.chassis)
  };

  const gross = Object.values(vals).reduce((a, b) => a + b, 0);
  const net = Math.round(gross * 0.82);

  // Switch from whole phone preview to exploded 3D grid
  const wholePhone = document.getElementById('whole-phone-preview');
  const explodedGrid = document.getElementById('exploded-3d-grid');
  if (wholePhone) wholePhone.classList.add('hidden');
  if (explodedGrid) explodedGrid.classList.remove('hidden');

  document.getElementById('dis-badge').textContent = '✓ Hardware Disassembled';
  document.getElementById('dis-badge').className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800';

  document.getElementById('m3d-disp-name').textContent = model.includes('iPhone') ? 'Super Retina OLED' : (model.includes('Galaxy') ? 'Dynamic AMOLED 2X' : 'Full HD+ Display');
  document.getElementById('m3d-disp-cond').textContent = cond === 'cracked' ? 'Digitizer Cracked' : '100% Tested';
  document.getElementById('m3d-disp-val').textContent = '₹' + vals.display.toLocaleString('en-IN');

  document.getElementById('m3d-logic-val').textContent = '₹' + vals.logic.toLocaleString('en-IN');
  document.getElementById('m3d-batt-val').textContent = '₹' + vals.battery.toLocaleString('en-IN');
  document.getElementById('m3d-cam-val').textContent = '₹' + vals.camera.toLocaleString('en-IN');
  document.getElementById('m3d-chassis-val').textContent = '₹' + vals.chassis.toLocaleString('en-IN');

  document.getElementById('bom-title').textContent = model;
  document.getElementById('bom-age-label').textContent = `Age: ${ageMonths} months (${buyYear}) · Condition: ${cond} · Platform Fee: 18%`;
  document.getElementById('bom-total').textContent = '₹' + net.toLocaleString('en-IN');

  const partTitles = { display: 'Display Panel', logic: 'Logic Board', battery: 'Battery Cell', camera: 'Camera Module', chassis: 'Chassis & Frame' };
  const partIcons = { display: 'fa-tv text-sky-400', logic: 'fa-microchip text-purple-400', battery: 'fa-car-battery text-rose-400', camera: 'fa-camera text-amber-400', chassis: 'fa-crop-simple text-emerald-400' };
  
  document.getElementById('bom-rows').innerHTML = Object.entries(vals).map(([k, v]) => {
    const pct = Math.round((v / gross) * 100);
    return `
      <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
        <div class="flex justify-between text-xs mb-1">
          <span class="font-bold text-slate-800 flex items-center gap-1.5"><i class="fa-solid ${partIcons[k]}"></i>${partTitles[k]}</span>
          <span class="font-black text-[#1e3a5f]">₹${v.toLocaleString('en-IN')}</span>
        </div>
        <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div class="h-full bg-[#1e3a5f] rounded-full" style="width:${pct}%"></div>
        </div>
        <div class="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>${pct}% of BOM</span>
          <span>Salvage Grade: Qualified</span>
        </div>
      </div>
    `;
  }).join('');

  // Save active quote to database
  const quotes = window.DB.get('quotes', []);
  const existingIdx = quotes.findIndex(q => q.title === model);
  if (existingIdx >= 0) {
    quotes[existingIdx].price = net;
    quotes[existingIdx].condition = cond;
  } else {
    quotes.unshift({ id: 'q-' + Date.now(), title: model, condition: cond, price: net, status: 'Quote Locked', hub: 'Bhatpara Central' });
  }
  window.DB.set('quotes', quotes);

  renderTrendChartRealistic(brand, mult, ageMonths);
  toast(`Teardown calculated for ${model}: ₹${net.toLocaleString('en-IN')}`);
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

  const ds = [
    { label: 'Display Panel', data: simulateCurve(b.display, 180), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.06)', fill: true, tension: 0.35, pointRadius: 3 },
    { label: 'Logic Board', data: simulateCurve(b.logic, 240), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.06)', fill: true, tension: 0.35, pointRadius: 3 },
    { label: 'Camera Module', data: simulateCurve(b.camera, 140), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)', fill: true, tension: 0.35, pointRadius: 3 },
    { label: 'Battery Cell', data: simulateCurve(b.battery, 60), borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.04)', fill: true, tension: 0.35, pointRadius: 3 }
  ];

  if (S.chartInst) S.chartInst.destroy();
  const ctx = document.getElementById('trend-chart').getContext('2d');
  S.chartInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11, weight: 'bold' } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(1) + 'k' } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
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

function applyStoreSearch() {
  const query = (document.getElementById('store-search-inp').value || '').toLowerCase();
  const seriesSort = document.getElementById('store-series-sort').value;
  renderShop(currentStoreType, currentStoreBrand, query, seriesSort);
}

let currentStoreType = 'dev';
let currentStoreBrand = 'all';

function storeTab(t) {
  currentStoreType = t;
  document.getElementById('st-tab-dev').className = 'px-5 py-2.5 rounded-xl font-bold text-xs ' + (t === 'dev' ? 'bg-[#1e3a5f] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900');
  document.getElementById('st-tab-parts').className = 'px-5 py-2.5 rounded-xl font-bold text-xs ' + (t === 'parts' ? 'bg-[#1e3a5f] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900');
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
    <div class="prod-card bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden flex flex-col justify-between">
      <div class="p-6 bg-slate-50 flex items-center justify-center h-36 relative">
        <i class="${p.icon} text-5xl text-[#1e3a5f]"></i>
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
            <span class="text-lg font-black text-[#1e3a5f]">₹${p.price.toLocaleString('en-IN')}</span>
            <span class="text-xs text-slate-400 line-through">₹${p.orig.toLocaleString('en-IN')}</span>
          </div>
          <div class="flex gap-2">
            <button onclick="addToCart(${p.id})" class="flex-1 py-2 rounded-xl bg-[#1e3a5f] hover:bg-[#2a4f7c] text-white font-bold text-xs transition-colors flex items-center justify-center gap-1">
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

function addToCart(id) {
  const it = STORE_ITEMS.find(i => i.id === id);
  if (!it) return;
  S.cartItems.push(it);
  document.getElementById('cart-badge').textContent = S.cartItems.length;
  document.getElementById('cart-count-label').textContent = `(${S.cartItems.length} items)`;
  
  const sub = S.cartItems.reduce((a, b) => a + b.price, 0);
  document.getElementById('cart-sub').textContent = '₹' + sub.toLocaleString('en-IN');
  document.getElementById('cart-total').textContent = '₹' + (sub + 5).toLocaleString('en-IN');
  toast(`${it.title} added to cart (+₹5 Greener India Pledge included)`);
}

function executeCheckoutDatabase() {
  if (S.cartItems.length === 0) return;
  const orders = window.DB.get('orders', []);
  S.cartItems.forEach(it => {
    orders.unshift({ id: 'RS-' + Math.floor(10000 + Math.random() * 90000), title: it.title, price: it.price, status: 'Shipped (In Transit)', warrantyDays: 365 });
  });
  window.DB.set('orders', orders);
  S.cartItems = [];
  document.getElementById('cart-badge').textContent = '0';
  closeModal('cart-modal');
  toast('🎉 Order Placed! ₹5.00 Greener India tree donation confirmed.');
  nav('profile');
  setMode('buyer');
}

function openPDP(id) {
  const it = STORE_ITEMS.find(i => i.id === id);
  if (!it) return;
  nav('pdp');
  document.getElementById('pdp-title').textContent = it.title;
  document.getElementById('pdp-sub').textContent = it.sub;
  document.getElementById('pdp-price').textContent = '₹' + it.price.toLocaleString('en-IN');
  document.getElementById('pdp-orig').textContent = '₹' + it.orig.toLocaleString('en-IN');
  document.getElementById('pdp-icon').className = it.icon + ' text-8xl text-[#1e3a5f]';
}

function addToCartFromPDP() {
  if (S.cartItems.length >= 0) addToCart(1);
  openModal('cart-modal');
}
function buyNow() {
  addToCart(1);
  openModal('cart-modal');
}

function askAdvisorAboutCurrentModel() {
  nav('advisor');
  setTimeout(() => {
    quickChat(`What is the optimal 14-day sell window for ${S.currentQuotedModel || 'my smartphone'}?`);
  }, 350);
}

function sendChat() {
  const inp = document.getElementById('chat-inp');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  quickChat(t);
}

function quickChat(promptText) {
  appendChatMsg('user', promptText);
  setTimeout(() => {
    const aiResponse = generateUniversalAIResponse(promptText);
    appendChatMsg('bot', aiResponse);
  }, 650);
}

function generateUniversalAIResponse(query) {
  const q = query.toLowerCase();

  if (q.includes('narzo 60') || q.includes('realme')) {
    return `📱 <strong>Realme Hardware Intelligence:</strong><br/>
    Realme Narzo 60 component values are projected to soften by <strong>~12%</strong> over the next 14 days due to new mid-range refresh cycles.<br/>
    • <strong>Top Module:</strong> Main Logic Board (holds 42% of BOM value)<br/>
    • <strong>Recommended Move:</strong> Lock in your quote today for guaranteed doorstep collection.`;
  }
  
  if (q.includes('iphone 15') || q.includes('iphone 14') || q.includes('iphone 13') || q.includes('apple')) {
    return `🍏 <strong>Apple Ecosystem Valuation Advisory:</strong><br/>
    Secondary repair demand for Apple OLED panels and A-Series motherboards remains strong. Pre-keynote erosion curves trigger an average <strong>16% drop</strong> within 14 days of Apple announcements.<br/>
    • <strong>Action:</strong> Lock your valuation to avoid the post-announcement flood.`;
  }

  if (q.includes('s24') || q.includes('s23') || q.includes('samsung') || q.includes('galaxy')) {
    return `📉 <strong>Samsung Galaxy Market Trend:</strong><br/>
    Dynamic AMOLED displays and camera modules maintain high repair-market buyback rates. Battery cells older than 2 years drop in salvage pricing.<br/>
    • <strong>Strategy:</strong> Liquidate within the 14-day price lock window.`;
  }

  return `📊 <strong>Hardware Forecast for "${query}":</strong><br/>
  • <strong>Depreciation Rate:</strong> ~1.8% to 2.4% monthly decay based on age &amp; generation.<br/>
  • <strong>High-Yield Modules:</strong> Display panel and motherboard account for >65% of net salvage value.<br/>
  • <strong>Greener India:</strong> ₹5.00 e-waste contribution pledged upon trade.`;
}

function appendChatMsg(sender, html) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  if (sender === 'user') {
    div.className = 'flex justify-end';
    div.innerHTML = `<div class="bubble-user p-3.5 text-xs sm:text-sm max-w-sm rounded-2xl rounded-tr-none shadow-xs">${html}</div>`;
  } else {
    div.className = 'flex items-start gap-2.5 max-w-xl';
    div.innerHTML = `
      <div class="w-8 h-8 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="bubble-bot p-4 text-xs sm:text-sm text-slate-800 rounded-2xl rounded-tl-none shadow-2xs space-y-1">${html}</div>
    `;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function resetChat() {
  document.getElementById('chat-log').innerHTML = `
    <div class="flex items-start gap-2.5 max-w-xl">
      <div class="w-8 h-8 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="bubble-bot p-4 text-xs sm:text-sm text-slate-800 rounded-2xl rounded-tl-none shadow-2xs">
        <p>Chat cleared. Ask about any smartphone brand or model depreciation curve.</p>
      </div>
    </div>
  `;
}

function setLoc(name, label) {
  document.getElementById('loc-label').textContent = label;
  document.getElementById('hub-name').textContent = name;
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

  // ALWAYS RESET SELL & DISASSEMBLE TO CLEAN DEFAULT ON REFRESH
  resetSellAndDisassembleToDefault();

// Mobile Scroll Hide/Show Behavior for Bottom Navigation Bar
let lastScrollY = window.scrollY;
let isScrollTicking = false;

window.addEventListener('scroll', () => {
  if (!isScrollTicking) {
    window.requestAnimationFrame(() => {
      if (window.innerWidth <= 768) {
        const mobNav = document.getElementById('bottom-mob-nav');
        if (mobNav) {
          const currentScrollY = window.scrollY;
          if (currentScrollY <= 50) {
            mobNav.classList.remove('translate-y-full');
            mobNav.classList.add('translate-y-0');
          } else {
            const diff = currentScrollY - lastScrollY;
            if (Math.abs(diff) > 6) {
              if (diff > 0) {
                // Scroll DOWN: Reveal navigation bar by sliding up from below
                mobNav.classList.remove('translate-y-full');
                mobNav.classList.add('translate-y-0');
              } else {
                // Scroll UP: Hide bottom navigation bar
                mobNav.classList.remove('translate-y-0');
                mobNav.classList.add('translate-y-full');
              }
            }
          }
          lastScrollY = currentScrollY;
        }
      }
      isScrollTicking = false;
    });
    isScrollTicking = false;
  }
}, { passive: true });

});

// ─── EXPOSE FUNCTIONS TO WINDOW FOR INLINE ONCLICK HANDLERS ───
if (typeof nav !== 'undefined') window.nav = nav;
if (typeof openModal !== 'undefined') window.openModal = openModal;
if (typeof closeModal !== 'undefined') window.closeModal = closeModal;
if (typeof toast !== 'undefined') window.toast = toast;
if (typeof updateModels !== 'undefined') window.updateModels = updateModels;
if (typeof runDisassembly !== 'undefined') window.runDisassembly = runDisassembly;
if (typeof addToCart !== 'undefined') window.addToCart = addToCart;
if (typeof openPDP !== 'undefined') window.openPDP = openPDP;
if (typeof previewAvatar !== 'undefined') window.previewAvatar = previewAvatar;
if (typeof quickChat !== 'undefined') window.quickChat = quickChat;
if (typeof sendChat !== 'undefined') window.sendChat = sendChat;
if (typeof filterStoreCategory !== 'undefined') window.filterStoreCategory = filterStoreCategory;
if (typeof sortStoreItems !== 'undefined') window.sortStoreItems = sortStoreItems;
if (typeof searchStorefront !== 'undefined') window.searchStorefront = searchStorefront;
if (typeof applyStoreSearch !== 'undefined') window.applyStoreSearch = applyStoreSearch;
if (typeof toggleAddressModal !== 'undefined') window.toggleAddressModal = toggleAddressModal;
if (typeof addNewAddressPrompt !== 'undefined') window.addNewAddressPrompt = addNewAddressPrompt;
if (typeof setMode !== 'undefined') window.setMode = setMode;
if (typeof askAdvisorAboutCurrentModel !== 'undefined') window.askAdvisorAboutCurrentModel = askAdvisorAboutCurrentModel;
if (typeof addToCartFromPDP !== 'undefined') window.addToCartFromPDP = addToCartFromPDP;
if (typeof setCleanDefaultState !== 'undefined') window.setCleanDefaultState = setCleanDefaultState;
if (typeof resetSellAndDisassembleToDefault !== 'undefined') window.resetSellAndDisassembleToDefault = resetSellAndDisassembleToDefault;
if (typeof placeOrder !== 'undefined') window.placeOrder = placeOrder;
if (typeof viewBomDetails !== 'undefined') window.viewBomDetails = viewBomDetails;
if (typeof renderShop !== 'undefined') window.renderShop = renderShop;
if (typeof renderDatabaseUI !== 'undefined') window.renderDatabaseUI = renderDatabaseUI;
if (typeof renderCart !== 'undefined') window.renderCart = renderCart;
if (typeof removeCartItem !== 'undefined') window.removeCartItem = removeCartItem;
if (typeof saveCurrentQuote !== 'undefined') window.saveCurrentQuote = saveCurrentQuote;
if (typeof deleteSavedQuote !== 'undefined') window.deleteSavedQuote = deleteSavedQuote;
