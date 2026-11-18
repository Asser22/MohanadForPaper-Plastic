/*
 * Search that forgives spelling (docs/16): customers type the way they speak.
 *
 * Every word is compared at four levels, best first: the same word; the start of a word
 * (still typing); the same sounds (Egyptian spellings, dropped vowels, English letters
 * for a brand: "pampers"); and a slip of one or two letters. An item is found when every
 * word of the search matches something in its name, pack, section or sub-section.
 *
 * Words the shop's customers use for the same thing ("cup" said three ways) come from
 * the synonym groups in specs/ui-strings.ar.yaml (site.synonyms), so the shop can add
 * more without touching code. Words people put around what they want ("how much",
 * "wholesale": site.filler_words) count when they match but are never required.
 *
 * Works in the browser (window.MhndSearch) and in Node for the tests (module.exports).
 * No Arabic is written in this file: letters are \u escapes (CLAUDE.md rule 3).
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MhndSearch = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ALEF = "\u0627";
  var LAM = "\u0644";
  var HEH = "\u0647";
  var WAW = "\u0648";
  var YEH = "\u064A";

  // One spelling for the letters Arabic writes several ways.
  var FOLD = {
    "\u0622": ALEF, // alef madda
    "\u0623": ALEF, // alef hamza above
    "\u0625": ALEF, // alef hamza below
    "\u0671": ALEF, // alef wasla
    "\u0629": HEH, // teh marbuta
    "\u0649": YEH, // alef maksura
    "\u0624": WAW, // waw hamza
    "\u0626": YEH, // yeh hamza
    "\u06CC": YEH, // Persian yeh
    "\u06A9": "\u0643", // Persian kaf
    "\u0621": "", // hamza on its own
    "\u0640": "", // tatweel
    "\u00D7": "x", // multiplication sign, as in bag sizes
    "\u060C": " ", // Arabic comma
    "\u061B": " ", // Arabic semicolon
    "\u061F": " ", // Arabic question mark: "how much ...?"
    "\u06D4": " ", // Arabic full stop
    "\u066B": ".", // Arabic decimal separator
    "\u066C": "," // Arabic thousands separator
  };
  var d;
  for (d = 0; d < 10; d++) {
    FOLD[String.fromCharCode(0x0660 + d)] = String(d); // Arabic-Indic digits
    FOLD[String.fromCharCode(0x06F0 + d)] = String(d); // Eastern Arabic digits
  }
  var MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

  // Letters swapped when writing as spoken in Egypt; used only past the exact levels.
  var SOUNDS = {
    "\u062B": "\u062A", // tha -> ta
    "\u0637": "\u062A", // tah -> ta
    "\u0635": "\u0633", // sad -> seen
    "\u0630": "\u0632", // thal -> zay
    "\u0638": "\u0632", // zah -> zay
    "\u0636": "\u062F", // dad -> dal
    "\u0642": "\u0643", // qaf -> kaf
    "\u062D": HEH // hah -> heh
  };
  var LONG_VOWELS = /[\u0627\u0648\u064A]/g;

  var ARABIC = /[\u0600-\u06FF]/;
  var LATIN = /[a-z]/;
  var DIGITS = /^[0-9]+([.,][0-9]+)?$/;

  function normalise(text) {
    var lowered = String(text == null ? "" : text).toLowerCase().replace(MARKS, "");
    var out = "";
    for (var i = 0; i < lowered.length; i++) {
      var ch = lowered.charAt(i);
      out += Object.prototype.hasOwnProperty.call(FOLD, ch) ? FOLD[ch] : ch;
    }
    return out
      .replace(/([0-9])(?=[^0-9\s.,])/g, "$1 ") // "4x" -> "4 x"
      .replace(/([^0-9\s.,])(?=[0-9])/g, "$1 ") // "rqm4" -> "rqm 4"
      .replace(/[^0-9a-z\u0600-\u06FF.,]+/g, " ")
      .replace(/(^|\s)[.,]+|[.,]+(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function words(text) {
    var all = normalise(text).split(" ");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i]) out.push(all[i]);
    }
    return out;
  }

  // "al-" is written or left out at will: compare the word without it.
  function core(word) {
    if (word.length >= 4 && word.charAt(0) === ALEF && word.charAt(1) === LAM) {
      return word.slice(2);
    }
    return word;
  }

  function squeeze(word) {
    return word.replace(/(.)\1+/g, "$1");
  }

  function arabicSounds(word) {
    var w = core(word);
    var out = "";
    for (var i = 0; i < w.length; i++) {
      var ch = w.charAt(i);
      out += Object.prototype.hasOwnProperty.call(SOUNDS, ch) ? SOUNDS[ch] : ch;
    }
    // Long vowels come and go in spelling ("bambrz" / "bmbrz"); keep the first letter.
    return squeeze(out.charAt(0) + out.slice(1).replace(LONG_VOWELS, ""));
  }

  // English letters for an Arabic name, compared with the item's Latin slug, which
  // writes the Arabic letters the Egyptian way (jeem = g, qaf = k).
  function latinSounds(word) {
    var w = word
      .replace(/ph/g, "f")
      .replace(/gh/g, "g")
      .replace(/kh/g, "k")
      .replace(/[sc]h/g, "S")
      .replace(/th/g, "t")
      .replace(/ck/g, "k")
      .replace(/[qc]/g, "k")
      .replace(/x/g, "ks")
      .replace(/p/g, "b")
      .replace(/v/g, "f")
      .replace(/z/g, "s")
      .replace(/j/g, "g")
      .replace(/h/g, "");
    return squeeze(w.charAt(0) + w.slice(1).replace(/[aeiouyw]/g, ""));
  }

  function token(word, weight) {
    var latin = LATIN.test(word) && !ARABIC.test(word);
    var digit = DIGITS.test(word);
    return {
      w: word,
      c: core(word),
      s: digit ? word : latin ? latinSounds(word) : arabicSounds(word),
      latin: latin,
      digit: digit,
      weight: weight
    };
  }

  // Restricted Damerau-Levenshtein (a swap of two neighbours counts as one slip), giving
  // up as soon as the distance must exceed `max`.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev2 = null;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      var row = [i];
      var best = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
        if (
          prev2 &&
          i > 1 &&
          j > 1 &&
          a.charAt(i - 1) === b.charAt(j - 2) &&
          a.charAt(i - 2) === b.charAt(j - 1)
        ) {
          v = Math.min(v, prev2[j - 2] + 1);
        }
        row.push(v);
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = row;
    }
    return prev[b.length];
  }

  var EXACT = 10;
  var START = 8;
  var INSIDE = 6;
  var SOUND = 5;

  function score(q, t) {
    if (q.digit || t.digit) return q.digit && t.digit && q.w === t.w ? EXACT : 0;
    if (q.latin !== t.latin) return 0;
    var a = q.c;
    var b = t.c;
    if (q.w === t.w || a === b) return EXACT;
    if (a.length >= 2 && (b.indexOf(a) === 0 || t.w.indexOf(q.w) === 0)) return START;
    if (a.length >= 3 && b.indexOf(a) > 0) return INSIDE;
    if (q.s.length >= 3 && (q.s === t.s || (q.s.length >= 4 && t.s.indexOf(q.s) === 0))) {
      return SOUND;
    }
    if (a.length >= 4 && b.length >= 3) {
      var allow = a.length >= 7 ? 2 : 1;
      var slip = Math.min(distance(a, b, allow), distance(a, b.slice(0, a.length), allow));
      if (slip <= allow) return 4 - slip;
      if (q.s.length >= 5 && distance(q.s, t.s, 1) <= 1) return 2;
    }
    return 0;
  }

  function slugWords(slug) {
    return String(slug || "")
      .split("-")
      .filter(function (w) {
        return w && !DIGITS.test(w);
      });
  }

  var SYNONYM = 0.9; // a word found through a synonym ranks just below the word itself

  // {word: [the other words of its group]}, every word in its searchable form.
  function synonymTable(groups) {
    var table = {};
    for (var g = 0; g < (groups || []).length; g++) {
      var group = words(groups[g]).map(core);
      for (var k = 0; k < group.length; k++) {
        var others = table[group[k]] || [];
        for (var m = 0; m < group.length; m++) {
          if (m !== k && others.indexOf(group[m]) < 0) others.push(group[m]);
        }
        table[group[k]] = others;
      }
    }
    return table;
  }

  function fillerTable(list) {
    var table = {};
    for (var n = 0; n < (list || []).length; n++) {
      var w = words(list[n]);
      for (var k = 0; k < w.length; k++) table[core(w[k])] = true;
    }
    return table;
  }

  /*
   * data: {sections: [[name, slug]], subs: [[name, slug, section]],
   *        items: [[id, name, pack, sub, slug]], synonyms: ["word word word", ...],
   *        filler: ["word", ...]}
   * with sections, subs and items in printed order.
   */
  function index(data) {
    var out = [];
    for (var n = 0; n < data.items.length; n++) {
      var it = data.items[n];
      var sub = data.subs[it[3]];
      var sec = data.sections[sub[2]];
      var tokens = [];
      var add = function (text, weight, latinOnly) {
        var list = latinOnly ? slugWords(text) : words(text);
        for (var k = 0; k < list.length; k++) tokens.push(token(list[k], weight));
      };
      add(it[1], 1);
      add(it[2], 0.7);
      add(sub[0], 0.8);
      add(sec[0], 0.6);
      add(it[4], 0.9, true);
      add(sub[1], 0.8, true);
      add(sec[1], 0.6, true);
      out.push({
        id: it[0],
        order: n,
        tokens: tokens,
        compact: words(it[1]).join("")
      });
    }
    return {
      entries: out,
      synonyms: synonymTable(data.synonyms),
      filler: fillerTable(data.filler)
    };
  }

  function bestScore(q, tokens) {
    var best = 0;
    for (var j = 0; j < tokens.length; j++) {
      var s = score(q, tokens[j]) * tokens[j].weight;
      if (s > best) best = s;
    }
    return best;
  }

  function search(idx, query, limit) {
    var entries = idx.entries;
    var qw = words(query).filter(function (w) {
      return w.length > 1 || DIGITS.test(w);
    });
    if (!qw.length) return { ids: [], total: 0, close: false, empty: true };
    var qt = qw.map(function (w) {
      var t = token(w, 1);
      t.alts = (idx.synonyms[t.c] || []).map(function (alt) {
        return token(alt, SYNONYM);
      });
      t.optional = Boolean(idx.filler && idx.filler[t.c]);
      return t;
    });
    var required = qt.filter(function (t) {
      return !t.optional;
    }).length;
    if (!required) {
      // Only such words ("wholesale"): then they are what is being looked for.
      qt.forEach(function (t) {
        t.optional = false;
      });
      required = qt.length;
    }
    var compact = qt
      .filter(function (t) {
        return !t.optional;
      })
      .map(function (t) {
        return t.w;
      })
      .join("");
    var exact = [];
    var close = [];
    for (var n = 0; n < entries.length; n++) {
      var e = entries[n];
      var total = 0;
      var matched = 0;
      for (var i = 0; i < qt.length; i++) {
        var best = bestScore(qt[i], e.tokens);
        for (var a = 0; a < qt[i].alts.length; a++) {
          best = Math.max(best, bestScore(qt[i].alts[a], e.tokens) * SYNONYM);
        }
        if (best > 0) {
          if (!qt[i].optional) matched += 1;
          total += best;
        }
      }
      if (!matched) continue;
      if (e.compact.indexOf(compact) === 0) total += 6;
      else if (compact.length >= 3 && e.compact.indexOf(compact) > 0) total += 3;
      var hit = { id: e.id, order: e.order, score: total };
      if (matched === required) exact.push(hit);
      else if (required > 1 && matched * 2 >= required) close.push(hit);
    }
    var list = exact.length ? exact : close;
    list.sort(function (x, y) {
      return y.score - x.score || x.order - y.order;
    });
    return {
      ids: list.slice(0, limit || list.length).map(function (h) {
        return h.id;
      }),
      total: list.length,
      close: !exact.length && close.length > 0,
      empty: false
    };
  }

  return {
    normalise: normalise,
    words: words,
    distance: distance,
    index: index,
    search: search
  };
});

/*
 * The shop's small rules, applied in the browser (docs/16): prices written the way the
 * printed list writes them, whether the shop is open right now, and the order message
 * the basket sends on WhatsApp. Pure functions, so Node tests them (test_site_shop.py).
 *
 * Every word comes from the page's data (specs/ui-strings.ar.yaml); none is written here.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MhndShop = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY = 1440; // minutes
  var WEEK = 7 * DAY;

  function digits(value, arabic) {
    var s = String(value);
    if (!arabic) return s;
    return s.replace(/[0-9]/g, function (d) {
      return String.fromCharCode(0x0660 + Number(d));
    });
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m;
    });
  }

  /*
   * A price in piastres (100 to the pound) as numerals.format_price writes it:
   * style = {arabic, zeros: hide ".00", sep: group thousands from five digits}.
   */
  function price(cents, style) {
    var whole = Math.floor(cents / 100);
    var part = cents % 100;
    var text = String(whole);
    if (style.sep && whole >= 10000) {
      text = text.replace(/\B(?=(\d{3})+(?!\d))/g, style.arabic ? "\u066C" : ",");
    }
    if (!(style.zeros && part === 0)) {
      text += (style.arabic ? "\u066B" : ".") + (part < 10 ? "0" : "") + part;
    }
    return digits(text, style.arabic);
  }

  // Minutes after midnight as the shop says the time: "9 am", "11:30 pm".
  function clock(minutes, text, arabic) {
    var m = ((minutes % DAY) + DAY) % DAY;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    var out = String(h % 12 || 12) + (mm ? ":" + (mm < 10 ? "0" : "") + mm : "");
    return digits(out, arabic) + " " + (h < 12 ? text.am : text.pm);
  }

  /*
   * Open right now? hours: [[days (0 = Monday)], opens, closes] in minutes, a closing
   * time at or before the opening one being after midnight. now: {day, minutes} in the
   * shop's time zone. Returns {open, text}, or null when the shop gave no hours.
   */
  function openState(hours, now, text, arabic) {
    if (!hours || !hours.length) return null;
    var at = now.day * DAY + now.minutes;
    var spans = [];
    hours.forEach(function (h) {
      h[0].forEach(function (day) {
        var start = day * DAY + h[1];
        var end = day * DAY + (h[2] <= h[1] ? h[2] + DAY : h[2]);
        spans.push([start, end]);
      });
    });
    var i;
    for (i = 0; i < spans.length; i++) {
      var s = spans[i];
      // Late on Sunday, a Sunday-night opening runs into Monday: look a week on too.
      if ((at >= s[0] && at < s[1]) || (at + WEEK >= s[0] && at + WEEK < s[1])) {
        return { open: true, text: fill(text.open_now, { time: clock(s[1], text, arabic) }) };
      }
    }
    var next = null;
    for (i = 0; i < spans.length; i++) {
      var wait = (((spans[i][0] - at) % WEEK) + WEEK) % WEEK;
      if (next === null || wait < next.wait) next = { wait: wait, start: spans[i][0] % WEEK };
    }
    var day = Math.floor(next.start / DAY);
    var time = clock(next.start, text, arabic);
    var when;
    if (day === now.day && next.wait < DAY) when = fill(text.opens_today, { time: time });
    else if (day === (now.day + 1) % 7 && next.wait < 2 * DAY) {
      when = fill(text.opens_tomorrow, { time: time });
    } else when = fill(text.opens_on, { day: text.days[day], time: time });
    return { open: false, text: fill(text.closed_now, { when: when }) };
  }

  /*
   * The basket: entries [{title, qty, cents (null: no price of this kind)}] in the order
   * they were added. Returns {cents, priced, count}.
   */
  function totals(entries) {
    var cents = 0;
    var priced = 0;
    entries.forEach(function (e) {
      if (e.cents !== null && e.cents !== undefined) {
        cents += e.cents * e.qty;
        priced += 1;
      }
    });
    return { cents: cents, priced: priced, count: entries.length };
  }

  // The WhatsApp message for the whole order. The total only when every item is priced:
  // otherwise the shop works it out and says it.
  function orderMessage(entries, kind, note, text, style) {
    var lines = [fill(text.order_head, { kind: kind })];
    entries.forEach(function (e, n) {
      var values = {
        n: digits(n + 1, style.arabic),
        item: e.title,
        qty: digits(e.qty, style.arabic)
      };
      if (e.cents !== null && e.cents !== undefined) {
        values.price = price(e.cents, style);
        lines.push(fill(text.order_line_priced, values));
      } else {
        lines.push(fill(text.order_line, values));
      }
    });
    var sum = totals(entries);
    if (sum.count && sum.priced === sum.count) {
      lines.push(fill(text.order_total, { total: price(sum.cents, style) }));
    }
    var extra = String(note || "").trim();
    if (extra) lines.push(fill(text.order_note, { note: extra }));
    return lines.join("\n");
  }

  return {
    digits: digits,
    fill: fill,
    price: price,
    clock: clock,
    openState: openState,
    totals: totals,
    orderMessage: orderMessage
  };
});

/*
 * The page's behaviour (docs/16). The list is already in the page as HTML; this script
 * searches it (main page), follows the reader through the sections, opens pictures, keeps
 * the order basket, says whether the shop is open, and counts taps on WhatsApp and call.
 * Every word it shows comes from the page's data blocks (specs/ui-strings.ar.yaml), none
 * from here.
 */
(function () {
  "use strict";

  var Shop = window.MhndShop;
  var page = JSON.parse(document.getElementById("mhnd-page").textContent);
  var dataBlock = document.getElementById("mhnd-data");
  var data = dataBlock ? JSON.parse(dataBlock.textContent) : null; // the main page's search
  var text = page.text;
  var style = page.style;
  var fill = Shop.fill;
  var LIMIT = 80;

  var root = document.documentElement;
  var bar = document.getElementById("bar");
  var input = document.getElementById("q");
  var clearButton = document.getElementById("q-clear");
  var catalog = document.getElementById("catalog");
  var chips = document.getElementById("chips");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var rootMeta = document.querySelector('meta[name="mhnd-root"]');
  var siteRoot = rootMeta ? rootMeta.getAttribute("content") : "./";

  function digits(value) {
    return Shop.digits(value, style.arabic);
  }

  // An icon from the page's sprite (<symbol id="i-...">).
  function icon(id) {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(NS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function whatsapp(message) {
    return "https://wa.me/" + page.whatsapp + "?text=" + encodeURIComponent(message);
  }

  // The item a row shows, as a message names it: "name (pack)".
  function titleOf(row) {
    var name = row && row.querySelector(".item__name");
    if (!name) return "";
    var first = name.firstChild && name.firstChild.nodeType === 3 ? name.firstChild.nodeValue : "";
    var pack = name.querySelector(".item__pack");
    first = first.trim();
    return pack ? first + " (" + pack.textContent.trim() + ")" : first;
  }

  /* ---------------------------------------------------------------- counting taps */

  // GoatCounter records each tap as an event the shop reads in Telegram (the website
  // screen): which items people ask about, how many write on WhatsApp or call, and what
  // they searched for in vain.
  function count(name) {
    var counter = window.goatcounter;
    if (!name || !counter || typeof counter.count !== "function") return;
    try {
      counter.count({ path: name, title: name, event: true });
    } catch (e) {
      // Counting never gets in the way of the page.
    }
  }

  document.addEventListener(
    "click",
    function (event) {
      var el = event.target.closest("a, button");
      if (!el) return;
      var events = page.events;
      var href = el.getAttribute("href") || "";
      var item = el.closest(".item");
      if (el.classList.contains("item__ask") && item) {
        count(fill(events.ask, { item: titleOf(item) }));
      } else if (el.classList.contains("item__order") && item) {
        count(fill(events.order, { item: titleOf(item) }));
      } else if (el.id === "basket-send") count(events.basket);
      else if (el.id === "pdf") count(events.pdf);
      else if (el.id === "share") count(events.share);
      else if (href.indexOf("tel:") === 0) count(events.call);
      else if (href.indexOf("https://wa.me/") === 0) count(events.whatsapp);
    },
    true
  );

  // Anchors and the scroll position land below the sticky search bar, whatever its height.
  function measureBar() {
    root.style.setProperty("--bar-h", bar.offsetHeight + "px");
  }
  measureBar();
  if (window.ResizeObserver) new ResizeObserver(measureBar).observe(bar);

  /* ---------------------------------------------------------------- search */

  var searching = false;
  var run = function () {};
  var prices = root.getAttribute("data-prices") === "wholesale" ? "wholesale" : "retail";

  // The address keeps the search and the price choice, so a copied link opens the same.
  function syncUrl() {
    var params = [];
    var q = data ? input.value.trim() : "";
    if (q) params.push("q=" + encodeURIComponent(q));
    if (prices === "wholesale") params.push("prices=wholesale");
    var url = params.length ? "?" + params.join("&") : window.location.pathname;
    window.history.replaceState(null, "", url + window.location.hash);
  }

  if (data) {
    var index = window.MhndSearch.index(data);
    var results = document.getElementById("results");
    var resultsHead = document.getElementById("results-head");
    var resultsList = document.getElementById("results-list");
    var resultsEmpty = document.getElementById("results-empty");
    var askLink = document.getElementById("results-ask");
    var scrollBefore = 0;
    var urlTimer = 0;
    var missTimer = 0;
    var missed = {};

    // "category, then sub-section" under each search result.
    var where = {};
    data.items.forEach(function (it) {
      var sub = data.subs[it[3]];
      var sec = data.sections[sub[2]];
      where[it[0]] = fill(data.text.where, { category: sec[0], subcategory: sub[0] });
    });

    var showCatalog = function () {
      if (!searching) return;
      searching = false;
      results.hidden = true;
      catalog.hidden = false;
      resultsList.textContent = "";
      window.scrollTo(0, scrollBefore);
    };

    var startSearching = function () {
      if (searching) return;
      searching = true;
      scrollBefore = window.scrollY;
      catalog.hidden = true;
      results.hidden = false;
      var top = bar.getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top) window.scrollTo(0, top);
    };

    // A search that found nothing, once the reader stops typing: the shop learns what
    // people look for and do not find.
    var noteMiss = function (query) {
      // Never a phone number someone typed by mistake: only what was looked for.
      if (query.length < 3 || /[0-9\u0660-\u0669\u06F0-\u06F9]{7,}/.test(query)) return;
      missTimer = setTimeout(function () {
        if (input.value.trim() !== query || missed[query]) return;
        missed[query] = true;
        count(fill(page.events.missed, { query: query.slice(0, 60) }));
      }, 2500);
    };

    run = function () {
      var q = input.value;
      var shown = q.trim();
      clearButton.hidden = !q;
      clearTimeout(urlTimer);
      urlTimer = setTimeout(syncUrl, 400);
      clearTimeout(missTimer);
      var found = window.MhndSearch.search(index, q, LIMIT);
      if (found.empty) {
        showCatalog();
        return;
      }
      startSearching();
      resultsList.textContent = "";
      if (!found.total) {
        resultsHead.textContent = fill(data.text.no_results, { query: shown });
        resultsEmpty.hidden = false;
        if (askLink) askLink.href = whatsapp(fill(data.text.ask_query, { query: shown }));
        noteMiss(shown);
        return;
      }
      resultsEmpty.hidden = true;
      resultsHead.textContent = fill(found.close ? data.text.results_close : data.text.results, {
        count: digits(found.total),
        query: shown
      });
      var rows = document.createDocumentFragment();
      found.ids.forEach(function (id) {
        var row = document.getElementById("i" + id);
        if (!row) return;
        var copy = row.cloneNode(true);
        copy.removeAttribute("id");
        var place = document.createElement("span");
        place.className = "item__where";
        place.textContent = where[id];
        copy.querySelector(".item__body").appendChild(place);
        rows.appendChild(copy);
      });
      resultsList.appendChild(rows);
    };

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur(); // the phone's keyboard goes away and the results are in view
      } else if (event.key === "Escape" && input.value) {
        input.value = "";
        run();
      }
    });
    document.getElementById("search").addEventListener("submit", function (event) {
      event.preventDefault();
    });
    // A tapped section leaves the search, so the place it points at is on screen.
    document.addEventListener("click", function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link || !searching) return;
      input.value = "";
      run();
    });
  } else {
    // A section's page: the search box sends the words to the main page.
    input.addEventListener("input", function () {
      clearButton.hidden = !input.value;
    });
  }

  clearButton.addEventListener("click", function () {
    input.value = "";
    clearButton.hidden = true;
    run();
    input.focus();
  });
  document.addEventListener("keydown", function (event) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      input.focus();
    }
  });

  /* ---------------------------------------------------------------- retail / wholesale */

  var PRICES_KEY = "mhnd-prices";
  var priceButtons = Array.prototype.slice.call(document.querySelectorAll("[data-set-prices]"));
  var pdfLink = document.getElementById("pdf");
  var paintBasket = function () {};

  function setPrices(kind, remember) {
    prices = kind;
    if (kind === "wholesale") root.setAttribute("data-prices", "wholesale");
    else root.removeAttribute("data-prices");
    priceButtons.forEach(function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-set-prices") === kind ? "true" : "false");
    });
    if (pdfLink) pdfLink.href = pdfLink.getAttribute("data-" + kind) || pdfLink.href;
    if (remember) {
      try {
        window.localStorage.setItem(PRICES_KEY, kind);
      } catch (e) {
        // Private mode: the choice lasts for this visit only.
      }
      syncUrl();
    }
    paintBasket();
  }

  priceButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      setPrices(b.getAttribute("data-set-prices"), true);
    });
  });

  /* ---------------------------------------------------------------- the order basket */

  // + beside each item adds it; the bar at the bottom opens the order, which goes to the
  // shop as one WhatsApp message. Kept on this phone (localStorage) between visits.
  var sheet = document.getElementById("basket");
  if (sheet && sheet.showModal) {
    var BASKET_KEY = "mhnd-basket";
    var NOTE_KEY = "mhnd-basket-note";
    var MAX_QTY = 999;
    var basket = []; // [{id, title, r, w, qty}] in the order added; r, w in piastres
    var basketBar = document.getElementById("basket-bar");
    var basketCount = document.getElementById("basket-count");
    var basketList = document.getElementById("basket-list");
    var basketKind = document.getElementById("basket-kind");
    var basketEmpty = document.getElementById("basket-empty");
    var basketTotal = document.getElementById("basket-total");
    var basketNote = document.getElementById("basket-note");
    var basketSend = document.getElementById("basket-send");
    var basketClear = document.getElementById("basket-clear");
    var clearLabel = basketClear.lastChild.nodeValue;
    var armed = 0;

    var cents = function (value) {
      return typeof value === "number" && isFinite(value) && value >= 0 ? Math.round(value) : null;
    };

    var infoOf = function (row) {
      var body = row.querySelector(".item__body");
      var r = body.getAttribute("data-r");
      var w = body.getAttribute("data-w");
      return {
        id: Number(row.id.slice(1)),
        title: titleOf(row),
        r: r === null ? null : cents(Number(r)),
        w: w === null ? null : cents(Number(w)),
        qty: 1
      };
    };

    var load = function () {
      var stored = [];
      try {
        stored = JSON.parse(window.localStorage.getItem(BASKET_KEY) || "[]");
      } catch (e) {
        stored = [];
      }
      if (!Array.isArray(stored)) stored = [];
      basket = [];
      stored.forEach(function (e) {
        if (!e || typeof e.id !== "number" || !(e.qty >= 1)) return;
        var qty = Math.min(Math.floor(e.qty), MAX_QTY);
        var row = document.getElementById("i" + e.id);
        if (row) {
          // On the page: today's name and prices.
          var info = infoOf(row);
          info.qty = qty;
          basket.push(info);
        } else if (!data && typeof e.title === "string") {
          // Another section's item, seen on a section's page: as it was added.
          basket.push({ id: e.id, title: e.title, r: cents(e.r), w: cents(e.w), qty: qty });
        }
        // Missing from the main page, which holds every item: no longer sold.
      });
    };

    var save = function () {
      try {
        window.localStorage.setItem(BASKET_KEY, JSON.stringify(basket));
      } catch (e) {
        // Private mode: the order lasts for this visit only.
      }
    };

    var find = function (id) {
      for (var i = 0; i < basket.length; i++) if (basket[i].id === id) return i;
      return -1;
    };

    var change = function (id, by) {
      var at = find(id);
      if (at < 0) {
        var row = document.getElementById("i" + id);
        if (!row || by < 1) return;
        basket.push(infoOf(row));
      } else {
        basket[at].qty = Math.min(basket[at].qty + by, MAX_QTY);
        if (basket[at].qty < 1) basket.splice(at, 1);
      }
      save();
      paintBasket();
    };

    var lines = function () {
      return basket.map(function (e) {
        return { title: e.title, qty: e.qty, cents: prices === "wholesale" ? e.w : e.r };
      });
    };

    var button = function (kind, entry, name, label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "line__btn line__btn--" + kind;
      b.setAttribute("data-" + kind, String(entry.id));
      b.setAttribute("aria-label", fill(label, { item: entry.title }));
      b.appendChild(icon(name));
      return b;
    };

    var paintSheet = function () {
      basketList.textContent = "";
      basketKind.textContent =
        prices === "wholesale" ? text.prices_wholesale_long : text.prices_retail_long;
      basketEmpty.hidden = basket.length > 0;
      var items = lines();
      basket.forEach(function (e, n) {
        var li = document.createElement("li");
        li.className = "line";
        var name = document.createElement("span");
        name.className = "line__name";
        name.textContent = e.title;
        var price = document.createElement("span");
        price.className = "line__price";
        price.textContent =
          items[n].cents === null
            ? text.ask_price
            : Shop.price(items[n].cents * e.qty, style) + " " + text.currency;
        var qty = document.createElement("span");
        qty.className = "line__qty";
        qty.textContent = digits(e.qty);
        var step = document.createElement("span");
        step.className = "line__step";
        step.appendChild(button("more", e, "i-plus", text.basket_more));
        step.appendChild(qty);
        step.appendChild(button("less", e, "i-minus", text.basket_less));
        li.appendChild(name);
        li.appendChild(price);
        li.appendChild(step);
        li.appendChild(button("remove", e, "i-trash", text.basket_remove));
        basketList.appendChild(li);
      });
      var sum = Shop.totals(items);
      basketTotal.hidden = !sum.priced;
      if (sum.priced) {
        var template = sum.priced === sum.count ? text.basket_total : text.basket_total_some;
        basketTotal.textContent = fill(template, { total: Shop.price(sum.cents, style) });
      }
      var kind = text.kinds[prices];
      basketSend.href = whatsapp(Shop.orderMessage(items, kind, basketNote.value, text, style));
      basketSend.toggleAttribute("aria-disabled", !basket.length);
    };

    paintBasket = function () {
      var qty = {};
      basket.forEach(function (e) {
        qty[e.id] = e.qty;
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-add]"), function (b) {
        var q = qty[Number(b.getAttribute("data-add"))] || 0;
        var title = titleOf(b.closest(".item"));
        b.classList.toggle("item__add--in", q > 0);
        b.lastChild.textContent = q ? digits(q) : "";
        b.setAttribute(
          "aria-label",
          q ? fill(text.added, { item: title, qty: digits(q) }) : fill(text.add, { item: title })
        );
      });
      basketBar.hidden = !basket.length;
      document.body.classList.toggle("has-basket", basket.length > 0);
      basketCount.textContent = fill(text.basket_bar, { count: digits(basket.length) });
      if (sheet.open) paintSheet();
    };

    // + on every item; search results copy the row, + and all.
    Array.prototype.forEach.call(document.querySelectorAll(".item[id]"), function (row) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "item__add";
      b.setAttribute("data-add", row.id.slice(1));
      b.appendChild(icon("i-plus"));
      var qty = document.createElement("span");
      qty.className = "item__qty";
      b.appendChild(qty);
      row.appendChild(b);
    });

    document.addEventListener("click", function (event) {
      var add = event.target.closest("[data-add]");
      if (add) change(Number(add.getAttribute("data-add")), 1);
    });
    basketList.addEventListener("click", function (event) {
      var b = event.target.closest(".line__btn");
      if (!b) return;
      if (b.hasAttribute("data-more")) change(Number(b.getAttribute("data-more")), 1);
      else if (b.hasAttribute("data-less")) change(Number(b.getAttribute("data-less")), -1);
      else if (b.hasAttribute("data-remove")) {
        change(Number(b.getAttribute("data-remove")), -MAX_QTY);
      }
    });
    document.getElementById("basket-open").addEventListener("click", function () {
      paintSheet();
      sheet.showModal();
    });
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet || event.target.closest(".sheet__close")) sheet.close();
    });
    sheet.addEventListener("close", function () {
      clearTimeout(armed);
      armed = 0;
      basketClear.lastChild.nodeValue = clearLabel;
    });
    basketSend.addEventListener("click", function (event) {
      if (!basket.length) event.preventDefault();
    });
    basketNote.addEventListener("input", function () {
      try {
        window.localStorage.setItem(NOTE_KEY, basketNote.value);
      } catch (e) {
        // Private mode: this visit only.
      }
      paintSheet();
    });
    // Emptying the order takes a second tap: one slip of the thumb loses nothing.
    basketClear.addEventListener("click", function () {
      if (!armed) {
        armed = setTimeout(function () {
          armed = 0;
          basketClear.lastChild.nodeValue = clearLabel;
        }, 4000);
        basketClear.lastChild.nodeValue = text.basket_clear_confirm;
        return;
      }
      clearTimeout(armed);
      armed = 0;
      basket = [];
      basketNote.value = "";
      save();
      try {
        window.localStorage.removeItem(NOTE_KEY);
      } catch (e) {
        // Nothing stored.
      }
      paintBasket();
      sheet.close();
    });
    // The same order in every tab of the shop's site.
    window.addEventListener("storage", function (event) {
      if (event.key === BASKET_KEY) {
        load();
        paintBasket();
      }
    });

    try {
      basketNote.value = window.localStorage.getItem(NOTE_KEY) || "";
    } catch (e) {
      basketNote.value = "";
    }
    load();
    save();
  }

  setPrices(prices, false);

  if (data) {
    var initial = new URLSearchParams(window.location.search).get("q");
    if (initial) {
      input.value = initial;
      run();
    }
  }

  /* ---------------------------------------------------------------- open now */

  var openState = document.getElementById("open-state");

  function shopTime() {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: page.timezone,
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23"
      }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) {
        map[p.type] = p.value;
      });
      var day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(map.weekday);
      var hour = Number(map.hour) % 24;
      var minute = Number(map.minute);
      if (day < 0 || isNaN(hour) || isNaN(minute)) return null;
      return { day: day, minutes: hour * 60 + minute };
    } catch (e) {
      return null;
    }
  }

  function paintOpen() {
    var now = shopTime();
    var state = now && Shop.openState(page.hours, now, text, style.arabic);
    if (!state) {
      openState.hidden = true;
      return;
    }
    openState.textContent = state.text;
    openState.classList.toggle("sign__open--open", state.open);
    openState.hidden = false;
  }

  if (openState) {
    paintOpen();
    setInterval(paintOpen, 60000);
  }

  /* ---------------------------------------------------------------- where am I */

  var sections = Array.prototype.slice.call(document.querySelectorAll(".cat"));
  var marks = Array.prototype.slice.call(document.querySelectorAll("[data-for]"));
  var current = null;

  function centreChip(chip) {
    if (!chips || !chip || !chips.offsetParent) return;
    var box = chips.getBoundingClientRect();
    var r = chip.getBoundingClientRect();
    chips.scrollBy({ left: r.left + r.width / 2 - (box.left + box.width / 2), behavior: "auto" });
  }

  function mark(id) {
    if (id === current) return;
    current = id;
    marks.forEach(function (el) {
      if (el.getAttribute("data-for") === id) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    });
    centreChip(chips && chips.querySelector('[data-for="' + id + '"]'));
  }

  function follow() {
    if (searching || !marks.length) return;
    var line = bar.offsetHeight + 24;
    var found = sections.length ? sections[0].id : null;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top - line <= 0) found = sections[i].id;
      else break;
    }
    mark(found);
  }

  var toTop = document.getElementById("totop");
  var footer = document.querySelector(".foot");
  var ticking = false;
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(function () {
          ticking = false;
          follow();
          // Shown once the reader is well down the list; gone again over the footer's buttons.
          toTop.hidden =
            window.scrollY < window.innerHeight * 1.5 ||
            footer.getBoundingClientRect().top < window.innerHeight;
        });
      }
    },
    { passive: true }
  );

  // On a section's page its chip is the current one: in view from the start, and again
  // once the fonts have given every chip its final width.
  var currentChip = chips && chips.querySelector('[aria-current="page"]');
  centreChip(currentChip);
  window.addEventListener("load", function () {
    centreChip(currentChip);
  });

  /* ---------------------------------------------------------------- back to the top */

  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });

  /* ---------------------------------------------------------------- pictures */

  var viewer = document.getElementById("photo");
  var viewerImg = document.getElementById("photo-img");
  var viewerName = document.getElementById("photo-name");
  var viewerPrice = document.getElementById("photo-price");

  document.addEventListener("click", function (event) {
    var pic = event.target.closest("button.item__pic");
    if (!pic || !viewer || !viewer.showModal) return;
    var row = pic.closest(".item");
    var price = row.querySelector(
      ".item__slot--" + prices + " .item__price:not(.item__price--none)"
    );
    viewerImg.src = pic.getAttribute("data-full");
    viewerImg.alt = pic.getAttribute("aria-label") || "";
    viewerName.textContent = row.querySelector(".item__name").textContent.trim();
    viewerPrice.textContent = price ? price.textContent.trim() : "";
    viewer.showModal();
  });
  if (viewer) {
    viewer.addEventListener("click", function (event) {
      if (event.target === viewer || event.target.closest(".photo__close")) viewer.close();
    });
    viewer.addEventListener("close", function () {
      viewerImg.removeAttribute("src");
    });
  }

  /* ---------------------------------------------------------------- light / dark */

  var THEME_KEY = "mhnd-theme";
  var themeButton = document.getElementById("theme");
  var themeColor = document.getElementById("theme-color");

  function setTheme(kind) {
    if (kind === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    if (themeColor) themeColor.setAttribute("content", themeColor.getAttribute("data-" + kind));
    if (themeButton) {
      // The button offers the other look.
      themeButton.setAttribute(
        "aria-label",
        themeButton.getAttribute(kind === "light" ? "data-dark" : "data-light")
      );
    }
  }

  setTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      setTheme(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        // Private mode: this visit only.
      }
    });
  }

  /* ---------------------------------------------------------------- share */

  var shareButton = document.getElementById("share");
  if (shareButton) {
    shareButton.addEventListener("click", function () {
      var url = shareButton.getAttribute("data-url");
      var words = shareButton.getAttribute("data-text");
      if (navigator.share) {
        navigator.share({ title: document.title, text: words, url: url }).catch(function () {});
        return;
      }
      var label = shareButton.querySelector("span");
      var before = label.textContent;
      var done = function () {
        label.textContent = shareButton.getAttribute("data-copied");
        setTimeout(function () {
          label.textContent = before;
        }, 2000);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () {});
    });
  }

  /* ---------------------------------------------------------------- always the newest */

  // Browsers may keep a page for ten minutes. version.json says which build is newest;
  // a phone holding an older one fetches the new page (once per build, no loop).
  var buildMeta = document.querySelector('meta[name="mhnd-build"]');
  var build = buildMeta ? buildMeta.getAttribute("content") : "";

  (function dropVersionParam() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has("v")) return;
    params.delete("v");
    var rest = params.toString();
    window.history.replaceState(
      null,
      "",
      (rest ? "?" + rest : window.location.pathname) + window.location.hash
    );
  })();

  function checkFresh() {
    if (!window.fetch || !build) return;
    fetch(siteRoot + "version.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (v) {
        if (!v || !v.build || v.build === build) return;
        try {
          if (window.sessionStorage.getItem("mhnd-fetched") === v.build) return;
          window.sessionStorage.setItem("mhnd-fetched", v.build);
        } catch (e) {
          return;
        }
        var params = new URLSearchParams(window.location.search);
        params.set("v", v.build.slice(0, 10));
        window.location.replace("?" + params.toString() + window.location.hash);
      })
      .catch(function () {});
  }

  checkFresh();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") checkFresh();
  });

  follow();
})();
