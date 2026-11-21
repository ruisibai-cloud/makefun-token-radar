// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view with the
// model's own breakdown and farm plan, and a sandbox that re-ranks the board live under
// constants the reader changes. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var DEFAULTS = { growthWeight: DATA.model.growth_weight, maturityFloor: DATA.model.maturity_floor, multipleScale: 1 };
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

  // The model in one function, the same arithmetic main.ts runs: the page recomputes a
  // row from the snapshot figures and checks the number board.json carries, so the page
  // and the board are visibly the same model. `tweak` is the sandbox's constants, or null.
  function impliedOf(row, tweak) {
    var m = DATA.model;
    var weight = tweak ? tweak.growthWeight : m.growth_weight;
    var floor = tweak ? tweak.maturityFloor : m.maturity_floor;
    var scale = tweak ? tweak.multipleScale : 1;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var capped = Math.min(Math.max(age, 0), m.maturity_days);
    var maturity = floor + (Math.log(1 + capped) / Math.log(1 + m.maturity_days)) * m.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains) * m.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * scale * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Rows as the table shows them: sandbox on, every implied value recomputed and the
  // board re-ranked under the reader's constants; sandbox off, the submitted board.
  function viewRows() {
    var list = DATA.rows.map(function (r) {
      var value = state.sandbox ? impliedOf(r, state.sandbox) : r.implied_value_usd;
      return { row: r, value: value };
    });
    if (state.sandbox) {
      list.sort(function (a, b) { return b.value - a.value || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
      list.forEach(function (item, i) { item.displayRank = i + 1; });
    } else {
      list.forEach(function (item) { item.displayRank = item.row.rank; });
    }
    return list;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (item) {
      var r = item.row;
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else { av = a.value; bv = b.value; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', null,
          el('span', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('span', { class: 'brand-sub', text: 'Pre-token protocols, ranked by implied value' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { class: 'pill', html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { class: 'pill', html: 'Source <b>DefiLlama index</b>' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', null,
        el('span', { class: 'hl', text: String(DATA.board_size) + ' clean pre-token protocols' }),
        document.createTextNode(', ranked by an implied value the market itself calibrates')
      ),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. This board adds every other protocol that passes the same cleanliness rule — ' + DATA.early_size + ' early finds, ' + DATA.above_floor_extra + ' of them above the floor. Implied value is a model, not a price.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is on the board' })),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early finds beyond the watchlist' })),
        el('div', { class: 'stat' }, el('span', { text: 'Global comp multiple' }), el('b', { text: 'x' + fmtMult(DATA.global_multiple) }), el('small', { text: 'median mcap / TVL of live-token protocols' })),
        el('div', { class: 'stat' }, el('span', { text: 'Set aside' }), el('b', { text: String(DATA.set_aside) }), el('small', { text: 'already trading, or wrapped / staked products' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchOnly ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token (' + DATA.live.length + ')', onclick: function () { state.tab = 'live'; render(); } });
    var box = el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'wl' }, wl, document.createTextNode('Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filtered().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols, by market cap' })
    );
    if (state.sandbox) {
      box.appendChild(el('div', { class: 'sandbox-note' },
        el('span', { text: 'Sandbox on: the board below is re-ranked with your constants, not the submitted board. The detail view always shows the submitted numbers.' }),
        el('button', { type: 'button', text: 'Reset to submitted model', onclick: function () { state.sandbox = null; render(); } })
      ));
    }
    return box;
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sorted(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (item) { return item.value; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (item) {
      var r = item.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank-cell', text: String(item.displayRank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((item.value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(item.value) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'badge wl' : 'badge early', text: r.watchlist ? 'Watchlist' : 'Early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { class: 'static' },
        el('td', null, el('span', { class: 'badge live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? 'x' + fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap / TVL ratios are the comps that calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var formula =
      'implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
      ' x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x ln(1 + min(age_days, ' + m.maturity_days + ')) / ln(' + (m.maturity_days + 1) + '))' +
      ' x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_chains + ')) )\n' +
      'category_multiple = median mcap / TVL of the live-token protocols in the category (' + m.min_comps + '+ comps), else the global median x' + fmtMult(DATA.global_multiple) +
      ', clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. Age unknown: ' + m.unknown_age_days + ' days.';
    var calRows = DATA.calibration.slice(0, 8).map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: 'x' + fmtMult(c.multiple) }),
        el('td', { class: 'num', text: c.comps + (c.fallback ? ' *' : '') })
      );
    });
    function slider(id, label, min, max, step, value, oninput) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      var out = el('output', { for: id, text: String(value) });
      input.addEventListener('input', function () { out.textContent = input.value; oninput(parseFloat(input.value)); });
      return el('div', { class: 'slider-row' }, el('label', { for: id, text: label }), input, out);
    }
    function setSandbox(patch) {
      if (!state.sandbox) state.sandbox = { growthWeight: DEFAULTS.growthWeight, maturityFloor: DEFAULTS.maturityFloor, multipleScale: DEFAULTS.multipleScale };
      Object.keys(patch).forEach(function (k) { state.sandbox[k] = patch[k]; });
      render();
    }
    var cur = state.sandbox || DEFAULTS;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot figures. The multiple is not a guess: it is the market’s own pricing, read off the live-token protocols in the same snapshot. No protocol name is special-cased.' }),
      el('div', { class: 'formula', text: formula }),
      el('div', { class: 'cols' },
        el('div', null,
          el('h3', { text: 'Calibration: live-token comps by category' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Multiple' }), el('th', { class: 'num', text: 'Comps' }))),
            el('tbody', null, calRows,
              el('tr', null, el('td', { text: 'Global median' }), el('td', { class: 'num', text: 'x' + fmtMult(DATA.global_multiple) }), el('td', { class: 'num', text: String(DATA.global_comps) }))
            )
          ),
          el('p', { class: 'note', text: '* Fewer than ' + m.min_comps + ' comps in the category, so the global median stands in. The full table covers every category on the board.' })
        ),
        el('div', null,
          el('h3', { text: 'Model sandbox: change the constants, re-rank the board' }),
          slider('sb-growth', 'Growth weight', 0, 1.2, 0.05, cur.growthWeight, function (v) { setSandbox({ growthWeight: v }); }),
          slider('sb-maturity', 'Maturity floor', 0.5, 0.9, 0.05, cur.maturityFloor, function (v) { setSandbox({ maturityFloor: v }); }),
          slider('sb-scale', 'Multiple scale', 0.5, 2, 0.05, cur.multipleScale, function (v) { setSandbox({ multipleScale: v }); }),
          el('div', { class: 'sandbox-actions' },
            el('button', { class: 'button ghost', type: 'button', text: 'Reset to submitted model', onclick: function () { state.sandbox = null; render(); } })
          ),
          el('p', { class: 'note', text: 'The sandbox re-ranks the table in this page only. The submitted board always uses the constants above.' })
        )
      )
    );
  }

  function signalsFor(r) {
    var out = [];
    out.push({ text: r.watchlist ? 'On the watchlist' : 'Early find: below the watchlist rule', tone: r.watchlist ? 'good' : '' });
    if (r.change_7d !== null && r.change_7d > 10) out.push({ text: 'Fast mover: ' + fmtPct(r.change_7d) + ' in 7 days', tone: 'good' });
    if (r.change_7d !== null && r.change_7d < -20) out.push({ text: 'Cooling: ' + fmtPct(r.change_7d) + ' in 7 days', tone: 'warn' });
    if (r.age_days !== null && r.age_days < 180) out.push({ text: 'Young: listed under 6 months ago', tone: 'warn' });
    if (r.age_days !== null && r.age_days > 1095) out.push({ text: 'Veteran: 3+ years with no token on record', tone: '' });
    if (r.age_days === null) out.push({ text: 'Age unreported: the model uses 365 days', tone: '' });
    if ((r.chains || []).length >= 5) out.push({ text: 'Multi-chain: ' + r.chains.length + ' chains', tone: 'good' });
    if ((r.chains || []).length === 1) out.push({ text: 'Single chain: ' + r.chains[0], tone: '' });
    if (r.fallback_multiple) out.push({ text: 'Category multiple falls back to the global median', tone: '' });
    if (r.tvl_usd >= 1e9) out.push({ text: 'Top-tier TVL: over $1B', tone: 'good' });
    return out;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row, null);
    var matches = recomputed === row.implied_value_usd;
    var mathline = fmtUsd(row.tvl_usd) + ' x ' + fmtMult(row.category_multiple) + ' (category multiple, ' + row.comps + (row.comps === 1 ? ' comp' : ' comps') + (row.fallback_multiple ? ', global fallback' : '') + ')' +
      ' x ' + row.growth_multiplier + ' (growth) x ' + row.maturity_multiplier + ' (maturity) x ' + row.breadth_multiplier + ' (breadth) = ' + fmtUsd(row.implied_value_usd) +
      '. The page recomputes this row as ' + fmtUsd(recomputed) + (matches ? ', the same number the board carries.' : ' — the data would be stale.');
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge ' + (row.watchlist ? 'wl' : 'early'), text: (row.watchlist ? 'Watchlist · ' : 'Early find · ') + 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'unreported') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var body = el('div', { class: 'detail-body' });
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model’s own breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: 'x' + fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'mathline', text: mathline }),
      state.sandbox ? el('p', { class: 'note', text: 'Sandbox is on: the table re-ranks with your constants. This detail always shows the submitted board’s numbers.' }) : null
    ));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Signals' }),
      el('div', { class: 'signals' }, signalsFor(row).map(function (s) { return el('span', { class: 'signal' + (s.tone ? ' ' + s.tone : ''), text: s.text }); }))
    ));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — what to do, what it costs, how long it takes' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(body);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'panel foot' },
      el('h2', { text: 'How to read this radar' }),
      el('p', { text: '“No token” means the snapshot records none: no market cap, no CoinGecko id, no symbol. A protocol on this board may still have a token its DefiLlama record does not carry, and the board says “records no token”, never “has none”. Every row passes the watchlist’s cleanliness rule — no wrapped, staked or bridged product, no exchange’s product, no versioned pool — except the rule’s parent-protocol part, which the snapshot’s ten fields cannot carry.' }),
      el('p', { text: 'Implied value answers one question: what would a token be worth if the protocol’s record stayed as it is? It is priced off the live-token protocols in the same snapshot, grown or shrunk by seven-day TVL change, weighted by how long the protocol has run, and widened a little for multi-chain reach. It does not predict whether or when a token is issued.' }),
      el('p', { text: 'Farm plans are derived from each protocol’s own record — its category, its chains, its TVL, its age — and every step names its cost and its time. Costs are estimates in gas and capital, not quotes. Nothing here is financial advice.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
