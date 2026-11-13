/* Aluljáró — a nézet működése. Nincs build lépés, nincsenek könyvtárak. */
(function () {
  "use strict";

  var data = window.TUNNEL;
  if (!data) {
    document.body.innerHTML = "<p style='padding:2rem;color:#f3eee3'>Nem sikerült betölteni a data.js fájlt.</p>";
    return;
  }

  var state = {
    wall: data.walls[0].id,
    edition: Math.max(0, data.editions.length - 1),
    front: null,
    back: null,
    dragging: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartScroll: 0,
    fading: false,
    pending: null
  };

  var els = {
    eyebrow: document.getElementById("site-eyebrow"),
    title: document.getElementById("site-title"),
    lede: document.getElementById("site-lede"),
    place: document.getElementById("site-place"),
    footnote: document.getElementById("site-footnote"),
    toggle: document.getElementById("wall-toggle"),
    viewport: document.getElementById("viewport"),
    stripA: document.getElementById("strip-a"),
    stripB: document.getElementById("strip-b"),
    prev: document.getElementById("nudge-prev"),
    next: document.getElementById("nudge-next"),
    date: document.getElementById("edition-date"),
    note: document.getElementById("edition-note"),
    slider: document.getElementById("time-slider"),
    ticks: document.getElementById("slider-ticks"),
    minimap: document.getElementById("minimap")
  };

  /* ---------- setup chrome ---------- */

  function initChrome() {
    els.eyebrow.textContent = data.site.eyebrow;
    els.title.textContent = data.site.title;
    els.lede.textContent = data.site.lede;
    els.place.textContent = data.site.place;
    var fn = data.site.footnote;
    if (fn && typeof fn === "object") {
      els.footnote.textContent = fn.prefix || "";
      var a = document.createElement("a");
      a.href = fn.href; a.target = "_blank"; a.rel = "noopener";
      a.textContent = fn.text;
      els.footnote.appendChild(a);
    } else { els.footnote.textContent = fn || ""; }
    var flag = document.querySelector(".placeholder-flag");
    if (flag) {
      if (data.site.flag) flag.textContent = data.site.flag;
      else flag.hidden = true;
    }
    var sliderBlock = document.querySelector(".slider-block");
    if (sliderBlock && data.editions.length < 2) sliderBlock.hidden = true;

    data.walls.forEach(function (wall, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
      btn.dataset.wall = wall.id;
      btn.textContent = wall.label;
      btn.addEventListener("click", function () { setWall(wall.id); });
      els.toggle.appendChild(btn);
    });

    var last = data.editions.length - 1;
    els.slider.min = "0";
    els.slider.max = String(last);
    els.slider.value = "0";
    els.slider.setAttribute("aria-valuemin", "0");
    els.slider.setAttribute("aria-valuemax", String(last));

    data.editions.forEach(function (ed, i) {
      var tick = document.createElement("button");
      tick.type = "button";
      tick.className = "tick" + (i === 0 ? " is-active" : "");
      tick.textContent = shortDate(ed.date);
      tick.addEventListener("click", function () { setEdition(i); });
      els.ticks.appendChild(tick);
    });

    buildMinimap();
  }

  function shortDate(iso) {
    var d = parseISO(iso);
    var months = ["jan.", "feb.", "márc.", "ápr.", "máj.", "jún.",
                  "júl.", "aug.", "szept.", "okt.", "nov.", "dec."];
    return d.getFullYear() + ". " + months[d.getMonth()] + " " + d.getDate() + ".";
  }

  function longDate(iso) {
    var d = parseISO(iso);
    var months = ["január", "február", "március", "április", "május", "június",
                  "július", "augusztus", "szeptember", "október", "november", "december"];
    return d.getFullYear() + ". " + months[d.getMonth()] + " " + d.getDate() + ".";
  }

  function parseISO(iso) {
    var p = iso.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }


  function currentEdition() {
    return data.editions[state.edition];
  }

  function wallLabel(id) {
    var w = data.walls.filter(function (x) { return x.id === id; })[0];
    return w ? w.label : id;
  }

  /* ---------- strip rendering ---------- */

  function wallImages(edition, wallId) {
    var raw = edition.images && edition.images[wallId];
    if (!raw) return [];
    if (typeof raw === "string") raw = [raw];
    return raw.map(function (entry) {
      if (!entry) return null;
      if (typeof entry === "string") return { src: entry };
      if (entry.src) return entry;
      return null;
    }).filter(Boolean);
  }

  function renderStrip(container, edition, wallId) {
    container.innerHTML = "";
    var items = wallImages(edition, wallId);
    var sideName = wallLabel(wallId);
    items.forEach(function (item, index) {
      var fig = document.createElement("figure");
      fig.className = "blob-piece";
      fig.dataset.image = String(index);

      var img = document.createElement("img");
      img.src = item.src;
      img.alt = sideName + ", " + edition.label;
      img.draggable = false;
      fig.appendChild(img);

      if (item.path && item.path.length >= 2) {
        fig.classList.add("is-follow");
        fig._followSpec = { path: item.path, scale: item.scale };
      }

      container.appendChild(fig);
    });
  }

  function interpolatePath(path, xPct) {
    if (!path || !path.length) return 50;
    if (xPct <= path[0][0]) return path[0][1];
    var i;
    for (i = 1; i < path.length; i++) {
      if (xPct <= path[i][0]) {
        var x0 = path[i - 1][0], y0 = path[i - 1][1];
        var x1 = path[i][0], y1 = path[i][1];
        var u = x1 === x0 ? 0 : (xPct - x0) / (x1 - x0);
        return y0 + (y1 - y0) * u;
      }
    }
    return path[path.length - 1][1];
  }

  function scaleFromPath(path) {
    var yMin = 100, yMax = 0, i;
    for (i = 0; i < path.length; i++) {
      if (path[i][1] < yMin) yMin = path[i][1];
      if (path[i][1] > yMax) yMax = path[i][1];
    }
    var lo = Math.max(yMin / 100, 0.08);
    var hi = Math.max(1 - yMax / 100, 0.08);
    var need = Math.max(0.5 / lo, 0.5 / hi) * 1.05;
    if (need < 1.35) need = 1.35;
    if (need > 2.8) need = 2.8;
    return need;
  }

  function setupFollow(container) {
    if (!container) return;
    var figs = container.querySelectorAll(".blob-piece.is-follow");
    Array.prototype.forEach.call(figs, function (fig) {
      var spec = fig._followSpec;
      var img = fig.querySelector("img");
      if (!spec || !img || !img.naturalHeight) return;
      var figH = fig.clientHeight;
      if (!figH) return;
      var scale = spec.scale || scaleFromPath(spec.path);
      var dispH = figH * scale;
      var dispW = (img.naturalWidth / img.naturalHeight) * dispH;
      fig.style.width = dispW + "px";
      img.style.height = dispH + "px";
      img.style.width = dispW + "px";
      var prevY = fig._follow && typeof fig._follow.y === "number" ? fig._follow.y : null;
      fig._follow = {
        path: spec.path,
        scale: scale,
        dispH: dispH,
        y: prevY,
        ty: 0
      };
      var target = computeFollowY(fig);
      fig._follow.ty = target;
      fig._follow.y = target;
      img.style.transform = "translateY(" + target.toFixed(2) + "px)";
    });
  }

  function computeFollowY(fig) {
    var info = fig._follow;
    if (!info) return 0;
    var vp = els.viewport;
    var fr = fig.getBoundingClientRect();
    var vr = vp.getBoundingClientRect();
    var centerX = vr.left + vr.width / 2;
    var xPct = fr.width ? ((centerX - fr.left) / fr.width) * 100 : 0;
    if (xPct < 0) xPct = 0;
    if (xPct > 100) xPct = 100;
    var yPct = interpolatePath(info.path, xPct);
    var Ih = info.dispH;
    var H = fig.clientHeight;
    var ty = H / 2 - (yPct / 100) * Ih;
    var tyMin = H - Ih;
    var tyMax = 0;
    if (ty < tyMin) ty = tyMin;
    if (ty > tyMax) ty = tyMax;
    return ty;
  }

  /* Vertical pan and the minimap both read the live scrollLeft.
     Wheel smoothing happens only on scrollLeft, so they must not lerp again. */
  function updateFollow() {
    var figs = document.querySelectorAll(".blob-piece.is-follow");
    Array.prototype.forEach.call(figs, function (fig) {
      if (!fig._follow) return;
      var y = computeFollowY(fig);
      fig._follow.ty = y;
      fig._follow.y = y;
      var img = fig.querySelector("img");
      if (img) img.style.transform = "translateY(" + y.toFixed(2) + "px)";
    });
  }

  function readyStrip(container) {
    return waitForImages(container).then(function () {
      setupFollow(container);
    });
  }

  function waitForImages(container) {
    var imgs = Array.prototype.slice.call(container.querySelectorAll("img"));
    return Promise.all(imgs.map(function (img) {
      if (img.decode) return img.decode().catch(function () {});
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
  }

  function scrollRatio() {
    var el = els.viewport;
    var max = el.scrollWidth - el.clientWidth;
    return max <= 0 ? 0 : el.scrollLeft / max;
  }

  /* Jobb fal is drawn exit→entrance, so invert the traveler on that side. */
  function mapScrollRatio() {
    var t = scrollRatio();
    return state.wall === "right" ? 1 - t : t;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function clampScrollLeft(x) {
    var vp = els.viewport;
    var max = Math.max(0, vp.scrollWidth - vp.clientWidth);
    if (x < 0) return 0;
    if (x > max) return max;
    return x;
  }

  var scrollCam = {
    vel: 0,
    targetVel: 0,
    raf: 0,
    last: 0,
    lastWheel: 0,
    applying: false,
    expected: 0
  };

  function stopScrollCam() {
    if (scrollCam.raf) {
      cancelAnimationFrame(scrollCam.raf);
      scrollCam.raf = 0;
    }
    scrollCam.last = 0;
    scrollCam.vel = 0;
    scrollCam.targetVel = 0;
  }

  function tickScrollCam(now) {
    var vp = els.viewport;
    var dt = scrollCam.last ? Math.min(40, now - scrollCam.last) : 16;
    scrollCam.last = now;
    /* Soft start: velocity eases toward the impulse target. */
    var tauAttack = prefersReducedMotion() ? 1 : 55;
    var ka = 1 - Math.exp(-dt / tauAttack);
    scrollCam.vel += (scrollCam.targetVel - scrollCam.vel) * ka;
    var max = Math.max(0, vp.scrollWidth - vp.clientWidth);
    var next = vp.scrollLeft + scrollCam.vel * dt;
    if (next <= 0) { next = 0; scrollCam.vel = 0; scrollCam.targetVel = 0; }
    else if (next >= max) { next = max; scrollCam.vel = 0; scrollCam.targetVel = 0; }
    scrollCam.applying = true;
    vp.scrollLeft = next;
    scrollCam.expected = vp.scrollLeft;
    scrollCam.applying = false;
    /* While a trackpad is still sending events, decay slowly; then glide to a stop. */
    var frictionTau = prefersReducedMotion() ? 1 : ((now - scrollCam.lastWheel) < 90 ? 420 : 200);
    scrollCam.targetVel *= Math.exp(-dt / frictionTau);
    var still = Math.abs(scrollCam.vel) < 0.008 && Math.abs(scrollCam.targetVel) < 0.008;
    if (still) {
      scrollCam.raf = 0;
      scrollCam.last = 0;
      scrollCam.vel = 0;
      scrollCam.targetVel = 0;
      return;
    }
    scrollCam.raf = requestAnimationFrame(tickScrollCam);
  }

  function wheelDeltaPx(e) {
    var scale = 1;
    if (e.deltaMode === 1) scale = 40; /* ~3 lines ≈ 120px, a generous notch */
    else if (e.deltaMode === 2) scale = els.viewport.clientWidth || 800;
    return { x: e.deltaX * scale, y: e.deltaY * scale };
  }

  function applyScrollRatio(ratio) {
    var el = els.viewport;
    var max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = Math.max(0, max) * ratio;
    stopScrollCam();
  }

  function applyPending() {
    if (!state.pending) return;
    var p = state.pending;
    state.pending = null;
    if (p.wall && p.wall !== state.wall) {
      state.wall = p.wall;
      updateWallButtons();
    }
    setEdition(p.edition, { force: true, fade: p.fade !== false });
  }

  function updateWallButtons() {
    Array.prototype.forEach.call(els.toggle.querySelectorAll("button"), function (btn) {
      btn.setAttribute("aria-selected", btn.dataset.wall === state.wall ? "true" : "false");
    });
  }

  function setEdition(index, options) {
    options = options || {};
    if (index < 0 || index >= data.editions.length) return;

    if (state.fading) {
      state.pending = {
        edition: index,
        wall: options.wall || state.wall,
        fade: options.fade !== false
      };
      return;
    }

    var wallId = options.wall || state.wall;
    if (index === state.edition && wallId === state.wall && !options.force) return;

    var fade = options.fade !== false;
    var ratio = scrollRatio();
    var edition = data.editions[index];

    if (!fade) {
      renderStrip(state.front, edition, wallId);
      state.edition = index;
      state.wall = wallId;
      updateWallButtons();
      updateEditionChrome();
      readyStrip(state.front).then(function () { applyScrollRatio(ratio); updateMinimap(); updateFollow(); });
      return;
    }

    state.fading = true;
    renderStrip(state.back, edition, wallId);
    readyStrip(state.back).then(function () {
      applyScrollRatio(ratio);
      state.back.classList.add("is-visible");
      state.front.classList.remove("is-visible");
      var outgoing = state.front;
      state.front = state.back;
      state.back = outgoing;
      state.edition = index;
      state.wall = wallId;
      updateWallButtons();
      updateEditionChrome();
      updateMinimap();
      updateFollow();
      window.setTimeout(function () {
        state.fading = false;
        state.back.innerHTML = "";
        applyPending();
      }, 600);
    });
  }

  function setWall(wallId) {
    if (wallId === state.wall && !state.pending) return;
    updateWallButtonsPending(wallId);
    setEdition(state.edition, { force: true, fade: true, wall: wallId });
  }

  function updateWallButtonsPending(wallId) {
    Array.prototype.forEach.call(els.toggle.querySelectorAll("button"), function (btn) {
      btn.setAttribute("aria-selected", btn.dataset.wall === wallId ? "true" : "false");
    });
  }

  function updateEditionChrome() {
    var ed = currentEdition();
    els.date.textContent = longDate(ed.date);
    els.date.setAttribute("datetime", ed.date);
    els.note.textContent = ed.note || "";
    els.slider.value = String(state.edition);
    els.slider.setAttribute("aria-valuenow", String(state.edition));
    els.slider.setAttribute("aria-valuetext", ed.label);
    Array.prototype.forEach.call(els.ticks.children, function (tick, i) {
      tick.classList.toggle("is-active", i === state.edition);
    });
  }

  /* ---------- scrolling ---------- */

  function bindScroll() {
    var vp = els.viewport;

    vp.addEventListener("wheel", function (e) {
      var d = wheelDeltaPx(e);
      var delta = Math.abs(d.x) >= Math.abs(d.y) ? d.x : d.y;
      if (!delta) return;
      e.preventDefault();
      if (prefersReducedMotion()) {
        stopScrollCam();
        vp.scrollLeft = clampScrollLeft(vp.scrollLeft + delta);
        return;
      }
      /* One mouse notch should travel a native-feeling, generous distance (~140px+).
         Trackpad deltas stay close to 1:1 so they remain natural. */
      if (e.deltaMode === 0 && Math.abs(delta) >= 80) {
        var sign = delta < 0 ? -1 : 1;
        delta = sign * Math.max(Math.abs(delta) * 1.25, 140);
      } else if (e.deltaMode !== 2) {
        delta *= 1.15;
      }
      var tauDecay = 200; /* px of travel ≈ impulse, since v * tau ≈ distance */
      scrollCam.targetVel += delta / tauDecay;
      scrollCam.lastWheel = performance.now();
      if (!scrollCam.raf) {
        scrollCam.last = 0;
        scrollCam.raf = requestAnimationFrame(tickScrollCam);
      }
    }, { passive: false });

    vp.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest && e.target.closest("button, a")) return;
      stopScrollCam();
      state.dragging = true;
      state.dragMoved = false;
      state.dragStartX = e.clientX;
      state.dragStartScroll = vp.scrollLeft;
      vp.classList.add("is-dragging");
      try { vp.setPointerCapture(e.pointerId); } catch (err) {}
    });

    vp.addEventListener("pointermove", function (e) {
      if (!state.dragging) return;
      var dx = e.clientX - state.dragStartX;
      if (Math.abs(dx) > 6) state.dragMoved = true;
      vp.scrollLeft = state.dragStartScroll - dx;
    });

    function endDrag(e) {
      if (!state.dragging) return;
      state.dragging = false;
      vp.classList.remove("is-dragging");
      if (e && e.pointerId) {
        try { vp.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      window.setTimeout(function () { state.dragMoved = false; }, 40);
    }

    vp.addEventListener("pointerup", endDrag);
    vp.addEventListener("pointercancel", endDrag);

    vp.addEventListener("scroll", function () {
      /* Ignore the scroll events we ourselves just wrote (Chrome may deliver
         them asynchronously). Only an external move — scrollbar, drag, keys —
         should cancel the wheel glide. */
      if (!scrollCam.applying && !(scrollCam.raf && Math.abs(vp.scrollLeft - scrollCam.expected) < 2)) {
        stopScrollCam();
      }
      updateMinimap();
      updateFollow();
    }, { passive: true });

    function nudgeBy(dx) {
      stopScrollCam();
      vp.scrollBy({ left: dx, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }

    els.prev.addEventListener("click", function () {
      nudgeBy(-vp.clientWidth * 0.72);
    });
    els.next.addEventListener("click", function () {
      nudgeBy(vp.clientWidth * 0.72);
    });

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeBy(-vp.clientWidth * 0.5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeBy(vp.clientWidth * 0.5);
      } else if (e.key === "[" || e.key === ",") {
        setEdition(state.edition - 1);
      } else if (e.key === "]" || e.key === ".") {
        setEdition(state.edition + 1);
      }
    });
  }





  /* ---------- minimap ---------- */

  /* Kör alakú, felnagyított neon radar. A séta pontja a középben
     marad, az útvonal csúszik alatta. Kijárat balra, bejárat jobbra
     a vázlat szerint; a kamera nem forog, hogy a BE/KI olvasható legyen. */
  var MAP = {
    view: { w: 160, h: 160, cx: 80, cy: 80, zoom: 2.2 },
    segments: [
      { id: "entrance", kind: "entry",   x1: 242, y1: 114, x2: 242, y2: 108 },
      { id: "stairs-1", kind: "marker",  x1: 242, y1: 108, x2: 242, y2: 68  },
      { id: "w0",       kind: "section", x1: 242, y1: 68,  x2: 242, y2: 28  },
      { id: "turn-1",   kind: "marker",  x1: 242, y1: 28,  x2: 230, y2: 28  },
      { id: "stairs-2", kind: "marker",  x1: 230, y1: 28,  x2: 200, y2: 28  },
      { id: "w1",       kind: "section", x1: 200, y1: 28,  x2: 176, y2: 28  },
      { id: "turn-2",   kind: "marker",  x1: 176, y1: 28,  x2: 168, y2: 38  },
      { id: "stairs-3", kind: "marker",  x1: 168, y1: 38,  x2: 150, y2: 61  },
      { id: "w2",       kind: "section", x1: 150, y1: 61,  x2: 140, y2: 74  },
      { id: "turn-3",   kind: "marker",  x1: 140, y1: 74,  x2: 128, y2: 74  },
      { id: "w3",       kind: "section", x1: 128, y1: 74,  x2: 28,  y2: 74  },
      { id: "exit",     kind: "exit",    x1: 28,  y1: 74,  x2: 16,  y2: 74  }
    ]
  };

  var mapCam = {
    x: MAP.segments[0].x1,
    y: MAP.segments[0].y1,
    tx: MAP.segments[0].x1,
    ty: MAP.segments[0].y1,
    raf: 0,
    last: 0
  };

  function segLen(s) {
    var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointOnRoute(t) {
    var total = 0;
    MAP.segments.forEach(function (s) { total += segLen(s); });
    var dist = Math.max(0, Math.min(1, t)) * total;
    var acc = 0;
    for (var i = 0; i < MAP.segments.length; i++) {
      var s = MAP.segments[i];
      var len = segLen(s);
      if (dist <= acc + len || i === MAP.segments.length - 1) {
        var u = len === 0 ? 0 : (dist - acc) / len;
        return { x: s.x1 + (s.x2 - s.x1) * u, y: s.y1 + (s.y2 - s.y1) * u, id: s.id };
      }
      acc += len;
    }
    var last = MAP.segments[MAP.segments.length - 1];
    return { x: last.x2, y: last.y2, id: last.id };
  }

  function tickMark(x1, y1, x2, y2, t, half) {
    var x = x1 + (x2 - x1) * t;
    var y = y1 + (y2 - y1) * t;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    return {
      x: x, y: y,
      d: "M " + (x - nx * half) + "," + (y - ny * half) +
         " L " + (x + nx * half) + "," + (y + ny * half)
    };
  }

  function mapWorldTransform(x, y) {
    return "translate(" + MAP.view.cx + " " + MAP.view.cy + ") scale(" + MAP.view.zoom + ") translate(" + (-x) + " " + (-y) + ")";
  }

  function applyMapCam() {
    var world = document.getElementById("map-world");
    if (!world) return;
    world.setAttribute("transform", mapWorldTransform(mapCam.x, mapCam.y));
  }

  function buildMinimap() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 160 160");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Kör alakú térkép: a világító pont a középben van, a pálya alatta mozog. Bejárat (BE) jobbra, kijárat (KI) balra. A lépcsők lefelé visznek.");

    function el(name, attrs, text) {
      var node = document.createElementNS(ns, name);
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text) node.textContent = text;
      return node;
    }

    var defs = el("defs", {});
    var glow = el("filter", { id: "neon-glow", x: "-80%", y: "-80%", width: "260%", height: "260%" });
    glow.appendChild(el("feGaussianBlur", { "in": "SourceGraphic", stdDeviation: "1.6", result: "blur" }));
    var merge = el("feMerge", {});
    merge.appendChild(el("feMergeNode", { "in": "blur" }));
    merge.appendChild(el("feMergeNode", { "in": "SourceGraphic" }));
    glow.appendChild(merge);
    defs.appendChild(glow);
    defs.appendChild(el("clipPath", { id: "radar-clip" }, null));
    defs.lastChild.appendChild(el("circle", { cx: "80", cy: "80", r: "72" }));
    svg.appendChild(defs);

    // Bezel and radar rings (fixed HUD).
    svg.appendChild(el("circle", {
      cx: "80", cy: "80", r: "79",
      fill: "rgba(12,12,11,0.22)",
      stroke: "#d6ff3c",
      "stroke-width": "1.4",
      opacity: "0.95",
      filter: "url(#neon-glow)"
    }));
    svg.appendChild(el("circle", {
      cx: "80", cy: "80", r: "72",
      fill: "none",
      stroke: "#d6ff3c",
      "stroke-width": "0.5",
      opacity: "0.28"
    }));
    svg.appendChild(el("circle", {
      cx: "80", cy: "80", r: "48",
      fill: "none",
      stroke: "#d6ff3c",
      "stroke-width": "0.4",
      opacity: "0.14"
    }));
    // Cardinal ticks on the rim.
    [[80, 8, 80, 16], [80, 144, 80, 152], [8, 80, 16, 80], [144, 80, 152, 80]].forEach(function (l) {
      svg.appendChild(el("line", {
        x1: String(l[0]), y1: String(l[1]), x2: String(l[2]), y2: String(l[3]),
        stroke: "#d6ff3c",
        "stroke-width": "1.2",
        "stroke-linecap": "round",
        opacity: "0.7"
      }));
    });

    var clipped = el("g", { "clip-path": "url(#radar-clip)" });
    var world = el("g", { id: "map-world", transform: mapWorldTransform(mapCam.x, mapCam.y) });

    var route = "M 242,114 V 28 H 176 L 140,74 H 16";
    world.appendChild(el("path", {
      d: route,
      fill: "none",
      stroke: "#d6ff3c",
      "stroke-width": "3.4",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: "0.22",
      filter: "url(#neon-glow)"
    }));
    world.appendChild(el("path", {
      d: route,
      fill: "none",
      stroke: "#d6ff3c",
      "stroke-width": "1.15",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      filter: "url(#neon-glow)"
    }));

    var stairs = [
      tickMark(242, 114, 242, 28, 0.50, 3.2),
      tickMark(242, 28, 176, 28, 0.65, 3.2),
      tickMark(176, 28, 140, 74, 0.50, 3.2)
    ];
    stairs.forEach(function (tk) {
      world.appendChild(el("path", {
        d: tk.d,
        fill: "none",
        stroke: "#d6ff3c",
        "stroke-width": "0.95",
        "stroke-linecap": "round",
        opacity: "0.95"
      }));
      world.appendChild(el("circle", {
        cx: String(tk.x), cy: String(tk.y), r: "0.85",
        fill: "#d6ff3c"
      }));
    });

    function lab(x, y, text, anchor) {
      return el("text", {
        x: String(x), y: String(y),
        fill: "#d6ff3c",
        "font-family": "IBM Plex Mono, ui-monospace, monospace",
        "font-size": "5.4",
        "font-weight": "500",
        "letter-spacing": "0.12em",
        "text-anchor": anchor || "middle"
      }, text);
    }
    world.appendChild(lab(242, 121, "BE", "middle"));
    world.appendChild(lab(16, 70.5, "KI", "middle"));

    clipped.appendChild(world);
    svg.appendChild(clipped);

    // Traveler is fixed at the radar centre; the path pans underneath.
    svg.appendChild(el("circle", {
      id: "map-you-halo",
      cx: String(MAP.view.cx),
      cy: String(MAP.view.cy),
      r: "9",
      fill: "#d6ff3c",
      opacity: "0.28"
    }));
    svg.appendChild(el("circle", {
      id: "map-you",
      cx: String(MAP.view.cx),
      cy: String(MAP.view.cy),
      r: "3.8",
      fill: "#d6ff3c",
      stroke: "#0c0c0b",
      "stroke-width": "1.3"
    }));

    els.minimap.innerHTML = "";
    els.minimap.appendChild(svg);
  }

  function updateMinimap() {
    if (!document.getElementById("map-world")) return;
    var pt = pointOnRoute(mapScrollRatio());
    mapCam.x = mapCam.tx = pt.x;
    mapCam.y = mapCam.ty = pt.y;
    applyMapCam();
  }

  /* ---------- boot ---------- */

  function boot() {
    initChrome();
    state.front = els.stripA;
    state.back = els.stripB;
    renderStrip(state.front, currentEdition(), state.wall);
    state.front.classList.add("is-visible");
    updateEditionChrome();
    bindScroll();
    els.slider.addEventListener("input", function () {
      setEdition(Number(els.slider.value));
    });
    readyStrip(state.front).then(function () { updateMinimap(); updateFollow(); });
    window.addEventListener("resize", function () {
      stopScrollCam();
      setupFollow(state.front);
      setupFollow(state.back);
      updateMinimap();
      updateFollow();
    });
  }

  boot();
})();
