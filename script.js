(function () {
  const root = document.getElementById('view-chain2d');
  if (!root) return;

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => Array.from(root.querySelectorAll(selector));

  const els = {
    spotInput: $('#chain2dSpotInput'),
    daysInput: $('#chain2dDaysInput'),
    rateInput: $('#chain2dRateInput'),
    volInput: $('#chain2dVolInput'),
    minStrikeInput: $('#chain2dMinStrikeInput'),
    maxStrikeInput: $('#chain2dMaxStrikeInput'),
    showPriceLabelsToggle: $('#chain2dShowPriceLabelsToggle'),
    rulerTrack: $('#chain2dRulerTrack'),
    spotRuler: $('#chain2dSpotRuler'),
    chainGrid: $('#chain2dChainGrid'),
    axisRangeLabel: $('#chain2dAxisRangeLabel'),
    footerMetrics: $('#chain2dFooterMetrics'),
    mainStage: $('.main-stage'),
    stageSpotLine: $('#chain2dStageSpotLine')
  };

  if (!els.spotInput || !els.rulerTrack || !els.chainGrid || !els.mainStage || !els.stageSpotLine) {
    return;
  }

  const state = {
    spot: 100,
    days: 90,
    rate: 4.5,
    vol: 45,
    steps: 250,
    minStrike: 60,
    maxStrike: 140,
    stepStrike: 5,
    axisMin: 60,
    axisMax: 140,
    dragging: false
  };

  function fmt(n, d = 2) {
    return Number(n).toFixed(d);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function syncPriceLabelVisibility() {
    root.classList.toggle(
      'chain2d-hide-price-labels',
      !!els.showPriceLabelsToggle && !els.showPriceLabelsToggle.checked
    );
  }

  function snap(v, step) {
    return Math.round(v / step) * step;
  }

  function readInputs() {
    state.spot = Number(els.spotInput.value || state.spot);
    state.days = Math.max(1, Number(els.daysInput.value || state.days));
    state.rate = Number(els.rateInput.value || state.rate);
    state.vol = Math.max(0.01, Number(els.volInput.value || state.vol));

    state.steps = 250;
    state.stepStrike = 5;

    state.minStrike = Number(els.minStrikeInput.value || state.minStrike);
    state.maxStrike = Number(els.maxStrikeInput.value || state.maxStrike);

    state.minStrike = snap(state.minStrike, state.stepStrike);
    state.maxStrike = snap(state.maxStrike, state.stepStrike);

    if (state.maxStrike < state.minStrike) state.maxStrike = state.minStrike;

    state.axisMin = state.minStrike;
    state.axisMax = state.maxStrike;

    state.spot = clamp(state.spot, state.axisMin, state.axisMax);

    els.spotInput.value = fmt(state.spot, 1);
    els.minStrikeInput.value = fmt(state.minStrike, 0);
    els.maxStrikeInput.value = fmt(state.maxStrike, 0);
  }

  function getStrikes() {
    const strikes = [];
    const start = snap(state.minStrike, state.stepStrike);
    const end = snap(state.maxStrike, state.stepStrike);
    for (let k = start; k <= end + 1e-9; k += state.stepStrike) {
      strikes.push(Number(k.toFixed(6)));
    }
    return strikes;
  }

  function priceToPct(price) {
    const range = state.axisMax - state.axisMin;
    if (range <= 0) return 0;
    return ((price - state.axisMin) / range) * 100;
  }

  function binomialAmerican(S, K, rPct, sigmaPct, days, steps, isCall) {
    const T = Math.max(days / 365, 1 / 365);
    const r = rPct / 100;
    const sigma = sigmaPct / 100;
    const n = Math.max(1, Math.round(steps));
    const dt = T / n;
    const u = Math.exp(sigma * Math.sqrt(dt));
    const d = 1 / u;
    const disc = Math.exp(-r * dt);
    let p = (Math.exp(r * dt) - d) / (u - d);
    p = clamp(p, 0, 1);

    const values = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const ST = S * Math.pow(u, n - i) * Math.pow(d, i);
      values[i] = isCall ? Math.max(ST - K, 0) : Math.max(K - ST, 0);
    }

    for (let step = n - 1; step >= 0; step--) {
      for (let i = 0; i <= step; i++) {
        const continuation = disc * (p * values[i] + (1 - p) * values[i + 1]);
        const Sstep = S * Math.pow(u, step - i) * Math.pow(d, i);
        const exercise = isCall ? Math.max(Sstep - K, 0) : Math.max(K - Sstep, 0);
        values[i] = Math.max(continuation, exercise);
      }
    }
    return values[0];
  }

  function nearestStrike(spot, strikes) {
    return strikes.reduce((best, k) => {
      const bestDist = Math.abs(best - spot);
      const curDist = Math.abs(k - spot);
      return curDist < bestDist ? k : best;
    }, strikes[0] ?? spot);
  }

  function focusForStrike(strike) {
    const dist = Math.abs(strike - state.spot);
    const stepsAway = dist / Math.max(state.stepStrike, 0.0001);
    if (stepsAway <= 6) return 1;
    const tailSteps = stepsAway - 6;
    const raw = Math.exp(-0.5 * Math.pow(tailSteps / 2.8, 2));
    return 0.16 + 0.84 * raw;
  }

  function makeBar(cls, leftPct, widthPct) {
    if (widthPct <= 0.06) return '';
    return `<div class="bar ${cls}" style="left:${leftPct}%; width:${widthPct}%;"></div>`;
  }

  function makeSegmentLabel(cls, leftPct, widthPct, value) {
    if (value <= 0.0001) return '';
    return `<div class="segment-label ${cls}" style="left:${leftPct}%; width:${Math.max(widthPct, 0.06)}%;"><span class="mono">${fmt(value, 2)}</span></div>`;
  }

  function adjustIntrinsicValueLabels() {
    $$('.segment-label.call-intrinsic').forEach((el) => {
      const span = el.querySelector('span');
      if (!span) return;
      const need = span.offsetWidth + 8;
      const have = el.getBoundingClientRect().width;
      const overshoot = Math.max(0, need - have);
      span.style.left = `${4 - overshoot}px`;
    });

    $$('.segment-label.put-intrinsic').forEach((el) => {
      const span = el.querySelector('span');
      if (!span) return;
      const need = span.offsetWidth + 8;
      const have = el.getBoundingClientRect().width;
      const overshoot = Math.max(0, need - have);
      span.style.right = `${4 - overshoot}px`;
    });
  }

  function renderRuler(strikes) {
    const spotPct = priceToPct(state.spot);
    const ticks = [];
    const tickStep = state.stepStrike;
    for (let x = state.axisMin; x <= state.axisMax + 1e-9; x += tickStep) {
      const pct = priceToPct(x);
      ticks.push(`
        <div class="ruler-tick" style="left:${pct}%"></div>
        <div class="ruler-tick-label mono" style="left:${pct}%">${x}</div>
      `);
    }
    els.rulerTrack.innerHTML = `
      ${ticks.join('')}
      <div class="spot-line" id="chain2dSpotLine" style="left:${spotPct}%">
        <div class="spot-hitbox" aria-hidden="true"></div>
        <div class="spot-badge"><small></small><strong class="mono">${fmt(state.spot, 2)}</strong></div>
        <div class="spot-handle"></div>
      </div>
    `;
    if (els.axisRangeLabel) {
      els.axisRangeLabel.textContent = `Axis ${state.axisMin} → ${state.axisMax}`;
    }
    if (els.footerMetrics) {
      els.footerMetrics.textContent = `${strikes.length} strikes · CRR ${state.steps} steps`;
    }
  }

  function buildRowStrikeTicks(strikes) {
    return `<div class="row-strike-ticks">${
      strikes.map((k) => {
        const pct = ((k - state.axisMin) / Math.max(state.axisMax - state.axisMin, 0.0001)) * 100;
        return `<div class="row-strike-tick" style="left:${pct}%"></div>`;
      }).join('')
    }</div>`;
  }

  function renderRows(strikes) {
    const spotPct = priceToPct(state.spot);
    const range = Math.max(state.axisMax - state.axisMin, 0.0001);
    const atmStrike = nearestStrike(state.spot, strikes);
    const rows = strikes.map((K) => {
      const strikePct = priceToPct(K);
      const call = binomialAmerican(state.spot, K, state.rate, state.vol, state.days, state.steps, true);
      const put = binomialAmerican(state.spot, K, state.rate, state.vol, state.days, state.steps, false);
      const callIntrinsic = Math.max(state.spot - K, 0);
      const putIntrinsic = Math.max(K - state.spot, 0);
      const callTime = Math.max(call - callIntrinsic, 0);
      const putTime = Math.max(put - putIntrinsic, 0);

      const callIntrinsicWidth = (callIntrinsic / range) * 100;
      const callTimeWidth = (callTime / range) * 100;
      const putIntrinsicWidth = (putIntrinsic / range) * 100;
      const putTimeWidth = (putTime / range) * 100;

      let bars = '';
      if (callIntrinsic > 0) {
        bars += makeBar('call-time', strikePct - callTimeWidth, callTimeWidth);
        bars += makeBar('call-intrinsic', strikePct, callIntrinsicWidth);
        bars += makeSegmentLabel('call-time', strikePct - callTimeWidth, callTimeWidth, callTime);
        bars += makeSegmentLabel('call-intrinsic', strikePct, callIntrinsicWidth, callIntrinsic);
      } else {
        bars += makeBar('call-time', spotPct - callTimeWidth, callTimeWidth);
        bars += makeSegmentLabel('call-time', spotPct - callTimeWidth, callTimeWidth, callTime);
      }
      if (putIntrinsic > 0) {
        bars += makeBar('put-intrinsic', spotPct, putIntrinsicWidth);
        bars += makeBar('put-time', strikePct, putTimeWidth);
        bars += makeSegmentLabel('put-intrinsic', spotPct, putIntrinsicWidth, putIntrinsic);
        bars += makeSegmentLabel('put-time', strikePct, putTimeWidth, putTime);
      } else {
        bars += makeBar('put-time', spotPct, putTimeWidth);
        bars += makeSegmentLabel('put-time', spotPct, putTimeWidth, putTime);
      }

      const atmClass = Math.abs(K - atmStrike) < 1e-9 ? 'row row-atm' : 'row';
      const focus = focusForStrike(K);
      return `
        <div class="${atmClass}" style="--focus:${focus.toFixed(4)}">
          <div class="strike-cell mono">${K}</div>
          <div class="axis-row">
            <div class="axis-track">
              ${buildRowStrikeTicks(strikes)}
              <div class="axis-baseline"></div>
              <div class="spot-ghost" style="left:${spotPct}%"></div>
              <div class="strike-marker" style="left:${strikePct}%"></div>
              ${bars}
            </div>
          </div>
        </div>
      `;
    }).join('');

    els.chainGrid.innerHTML = rows;

    const firstAxisTrack = els.chainGrid.querySelector('.axis-track');
    if (firstAxisTrack && els.stageSpotLine && els.mainStage && els.rulerTrack) {
      const topTrackRect = els.rulerTrack.getBoundingClientRect();
      const chainGridRect = els.chainGrid.getBoundingClientRect();
      const stageRect = els.mainStage.getBoundingClientRect();
      const lineLeft = (topTrackRect.left - stageRect.left) + topTrackRect.width * (spotPct / 100);
      const top = topTrackRect.top - stageRect.top;
      const bottom = chainGridRect.bottom - stageRect.top;

      els.stageSpotLine.style.left = `${lineLeft}px`;
      els.stageSpotLine.style.top = `${top}px`;
      els.stageSpotLine.style.height = `${Math.max(bottom - top, 0)}px`;
      els.stageSpotLine.style.display = 'block';
    }

    requestAnimationFrame(() => {
      adjustIntrinsicValueLabels();
      syncPriceLabelVisibility();
    });
  }

  const tutorial = {
    step: 1,
    overlay: null,
    bubble1: null,
    bubble2: null,
    bubble3: null,
    highlight: null,
    startButton: null,
    revealTimer: null,
    revealing: false,
    awaitingStart: false
  };

  function ensureTutorialOverlay() {
    if (tutorial.overlay) return tutorial.overlay;
    const overlay = document.createElement('div');
    overlay.className = 'chain2d-guide-overlay is-hidden';
    overlay.addEventListener('mousedown', tutorialAdvance, true);
    overlay.addEventListener('touchstart', tutorialAdvance, { passive: false, capture: true });
    root.appendChild(overlay);
    tutorial.overlay = overlay;
    return overlay;
  }

  function ensureTutorialBubble(step) {
    const key = step === 1 ? 'bubble1' : step === 2 ? 'bubble2' : 'bubble3';
    if (tutorial[key]) return tutorial[key];
    const bubble = document.createElement('div');
    bubble.className = 'chain2d-guide-bubble is-hidden';
    bubble.dataset.step = String(step);
    bubble.textContent = step === 1
      ? '左右拖动标的资产价格，观察不同行权价期权的价格、内在价值、时间价值的变化规律。'
      : step === 2
        ? '左侧纵轴处查看不同行权价。'
        : '请在此处配置期权链参数：隐含波动率、到期时间、行权价上下端。';
    ensureTutorialOverlay().appendChild(bubble);
    tutorial[key] = bubble;
    return bubble;
  }


  function ensureTutorialHighlight() {
    if (tutorial.highlight) return tutorial.highlight;
    const highlight = document.createElement('div');
    highlight.className = 'chain2d-guide-highlight is-hidden';
    ensureTutorialOverlay().appendChild(highlight);
    tutorial.highlight = highlight;
    return highlight;
  }

  function ensureTutorialStartButton() {
    if (tutorial.startButton) return tutorial.startButton;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chain2d-guide-start is-hidden';
    button.textContent = '开始使用';
    button.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (!tutorial.awaitingStart || tutorial.revealing) return;
      beginTutorialCurtainReveal();
    });
    button.addEventListener('mousedown', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    button.addEventListener('touchstart', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    }, { passive: false });
    ensureTutorialOverlay().appendChild(button);
    tutorial.startButton = button;
    return button;
  }

  function hideTutorialArtifacts() {
    const overlay = ensureTutorialOverlay();
    tutorial.awaitingStart = false;
    overlay.classList.remove('is-curtain-reveal', 'is-curtain-reveal-active', 'is-finale-dim');
    overlay.classList.add('is-hidden');
    [tutorial.bubble1, tutorial.bubble2, tutorial.bubble3, tutorial.highlight, tutorial.startButton].forEach((el) => {
      if (el) el.classList.add('is-hidden');
    });
  }

  function showTutorialStartPrompt() {
    const overlay = ensureTutorialOverlay();
    const startButton = ensureTutorialStartButton();
    [tutorial.bubble1, tutorial.bubble2, tutorial.bubble3, tutorial.highlight].forEach((el) => {
      if (el) el.classList.add('is-hidden');
    });
    tutorial.awaitingStart = true;
    overlay.classList.remove('is-hidden', 'is-curtain-reveal', 'is-curtain-reveal-active');
    overlay.classList.add('is-finale-dim');
    startButton.classList.remove('is-hidden');
  }

  function beginTutorialCurtainReveal() {
    tutorial.awaitingStart = false;
    const startButton = ensureTutorialStartButton();
    startButton.classList.add('is-hidden');
    playTutorialCurtainReveal();
  }

  function playTutorialCurtainReveal() {
    const overlay = ensureTutorialOverlay();
    [tutorial.bubble1, tutorial.bubble2, tutorial.bubble3, tutorial.highlight, tutorial.startButton].forEach((el) => {
      if (el) el.classList.add('is-hidden');
    });
    tutorial.revealing = true;
    overlay.classList.remove('is-hidden', 'is-curtain-reveal', 'is-curtain-reveal-active');
    overlay.classList.add('is-finale-dim');
    void overlay.offsetWidth;
    overlay.classList.add('is-curtain-reveal');
    requestAnimationFrame(() => {
      overlay.classList.add('is-curtain-reveal-active');
    });
    if (tutorial.revealTimer) clearTimeout(tutorial.revealTimer);
    tutorial.revealTimer = setTimeout(() => {
      tutorial.revealing = false;
      tutorial.awaitingStart = false;
      overlay.classList.remove('is-curtain-reveal', 'is-curtain-reveal-active', 'is-finale-dim');
      overlay.classList.add('is-hidden');
    }, 760);
  }

  function tutorialAdvance(evt) {
    if (!root.classList.contains('active')) return;
    if (tutorial.revealing) {
      if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      return;
    }
    if (tutorial.awaitingStart) {
      if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      const target = evt && evt.target && evt.target.closest ? evt.target.closest('.chain2d-guide-start') : null;
      if (target) beginTutorialCurtainReveal();
      return;
    }
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    if (tutorial.step === 1) {
      tutorial.step = 2;
      requestAnimationFrame(syncTutorialVisibility);
      return;
    }
    if (tutorial.step === 2) {
      tutorial.step = 3;
      requestAnimationFrame(syncTutorialVisibility);
      return;
    }
    if (tutorial.step === 3) {
      tutorial.step = 0;
      showTutorialStartPrompt();
    }
  }

  function getOverlayRect() {
    return ensureTutorialOverlay().getBoundingClientRect();
  }

  function positionStep1Bubble() {
    const bubble = ensureTutorialBubble(1);
    const overlay = ensureTutorialOverlay();
    const spotBadge = $('#chain2dSpotLine .spot-badge');
    if (!spotBadge) {
      bubble.classList.add('is-hidden');
      overlay.classList.add('is-hidden');
      return;
    }
    overlay.classList.remove('is-hidden');
    bubble.classList.remove('is-hidden');
    bubble.style.visibility = 'hidden';
    bubble.style.left = '0px';
    bubble.style.top = '0px';

    const overlayRect = getOverlayRect();
    const badgeRect = spotBadge.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const gap = 28;
    const minLeft = 16;
    const maxLeft = overlayRect.width - bubbleRect.width - 16;
    const left = Math.min(Math.max((badgeRect.left - overlayRect.left) + badgeRect.width / 2 - bubbleRect.width / 2, minLeft), Math.max(maxLeft, minLeft));
    const top = Math.max(16, (badgeRect.top - overlayRect.top) - bubbleRect.height - gap);

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = 'visible';
  }

  function positionStep2Guide() {
    const bubble = ensureTutorialBubble(2);
    const highlight = ensureTutorialHighlight();
    const overlay = ensureTutorialOverlay();
    const strikeCells = $$('.strike-cell');
    const firstAxisTrack = els.chainGrid.querySelector('.axis-track');
    const chainCard = els.chainGrid.closest('.card');
    if (!strikeCells.length || !firstAxisTrack || !chainCard) {
      bubble.classList.add('is-hidden');
      highlight.classList.add('is-hidden');
      overlay.classList.add('is-hidden');
      return;
    }

    const overlayRect = getOverlayRect();
    const rects = strikeCells.map((el) => el.getBoundingClientRect());
    const columnLeft = Math.min(...rects.map((r) => r.left));
    const columnRight = Math.max(...rects.map((r) => r.right));
    const columnTop = Math.min(...rects.map((r) => r.top));
    const columnBottom = Math.max(...rects.map((r) => r.bottom));
    const axisRect = firstAxisTrack.getBoundingClientRect();
    const chainRect = els.chainGrid.getBoundingClientRect();
    const chainCardRect = chainCard.getBoundingClientRect();

    overlay.classList.remove('is-hidden');
    highlight.classList.remove('is-hidden');
    const highlightPadLeft = 20;
    const highlightPadTop = 6;
    const highlightPadBottom = 6;
    const highlightPadRight = -40;
    const step2HorizontalShift = 40;
    highlight.style.left = `${Math.max(12, (columnLeft - overlayRect.left) - highlightPadLeft)}px`;
    highlight.style.top = `${Math.max(12, (columnTop - overlayRect.top) - highlightPadTop)}px`;
    highlight.style.width = `${Math.max(44, columnRight - columnLeft + highlightPadLeft + highlightPadRight)}px`;
    highlight.style.height = `${Math.max(80, columnBottom - columnTop + highlightPadTop + highlightPadBottom)}px`;

    bubble.classList.remove('is-hidden');
    bubble.style.visibility = 'hidden';
    bubble.style.left = '0px';
    bubble.style.top = '0px';

    const bubbleRect = bubble.getBoundingClientRect();
    const strikeColumnReserve = (columnRight - columnLeft) + 34;
    const contentLeft = (chainCardRect.left - overlayRect.left) + 18;
    const leftAnchor = contentLeft + strikeColumnReserve - step2HorizontalShift;
    const maxLeftByTrack = (axisRect.left - overlayRect.left) + 120 - step2HorizontalShift;
    const left = Math.min(
      Math.max(leftAnchor, 16),
      Math.max(16, Math.min(maxLeftByTrack, overlayRect.width - bubbleRect.width - 16))
    );
    const top = Math.min(
      Math.max((chainRect.top - overlayRect.top) + chainRect.height * 0.56 - bubbleRect.height / 2, 16),
      Math.max(16, overlayRect.height - bubbleRect.height - 16)
    );

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = 'visible';
  }

  function positionStep3Guide() {
    const bubble = ensureTutorialBubble(3);
    const overlay = ensureTutorialOverlay();
    const sidebar = root.querySelector('.sidebar');
    const toggleRow = root.querySelector('.toggle-row') || root.querySelector('.switch') || root.querySelector('.param-row:last-child');
    const volRow = els.volInput ? els.volInput.closest('.param-row') : null;
    const daysRow = els.daysInput ? els.daysInput.closest('.param-row') : null;
    const minStrikeRow = els.minStrikeInput ? els.minStrikeInput.closest('.param-row') : null;
    const maxStrikeRow = els.maxStrikeInput ? els.maxStrikeInput.closest('.param-row') : null;
    if (!sidebar || !toggleRow || !volRow || !daysRow || !minStrikeRow || !maxStrikeRow) {
      bubble.classList.add('is-hidden');
      overlay.classList.add('is-hidden');
      return;
    }

    const overlayRect = getOverlayRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const toggleRect = toggleRow.getBoundingClientRect();
    const watchedRects = [volRow, daysRow, minStrikeRow, maxStrikeRow].map((el) => el.getBoundingClientRect());
    const targetLeft = Math.min(...watchedRects.map((r) => r.left));
    const targetRight = Math.max(...watchedRects.map((r) => r.right));
    const targetCenterX = (targetLeft + targetRight) / 2;

    overlay.classList.remove('is-hidden');
    bubble.classList.remove('is-hidden');
    bubble.style.visibility = 'hidden';
    bubble.style.left = '0px';
    bubble.style.top = '0px';

    const sidebarInnerWidth = Math.max(180, Math.floor(sidebarRect.width - 40));
    bubble.style.width = `${sidebarInnerWidth}px`;
    bubble.style.maxWidth = `${sidebarInnerWidth}px`;
    bubble.style.height = 'auto';
    bubble.style.whiteSpace = 'normal';
    bubble.style.visibility = 'hidden';

    const bubbleRect = bubble.getBoundingClientRect();
    const minLeft = 16;
    const maxLeft = overlayRect.width - bubbleRect.width - 16;
    const preferredLeft = (sidebarRect.left - overlayRect.left) + (sidebarRect.width - bubbleRect.width) / 2;
    const left = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));

    const top = Math.min(
      Math.max((toggleRect.bottom - overlayRect.top) + 42, 16),
      Math.max(16, overlayRect.height - bubbleRect.height - 16)
    );

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = 'visible';
  }

  function syncTutorialVisibility() {
    hideTutorialArtifacts();
    if (!root.classList.contains('active') || tutorial.step === 0) return;
    const overlay = ensureTutorialOverlay();
    overlay.classList.remove('is-hidden');
    if (tutorial.step === 1) {
      requestAnimationFrame(positionStep1Bubble);
      return;
    }
    if (tutorial.step === 2) {
      requestAnimationFrame(positionStep2Guide);
      return;
    }
    if (tutorial.step === 3) {
      requestAnimationFrame(positionStep3Guide);
    }
  }

  function render() {
    readInputs();
    const strikes = getStrikes();
    renderRuler(strikes);
    renderRows(strikes);
    attachDrag();
    syncTutorialVisibility();
  }

  function getDragTrackRect(source = 'top') {
    if (source === 'chain') {
      const axisTrack = els.chainGrid.querySelector('.axis-track');
      if (axisTrack) return axisTrack.getBoundingClientRect();
    }
    return els.rulerTrack.getBoundingClientRect();
  }

  function pointerToSpot(clientX, source = 'top') {
    const rect = getDragTrackRect(source);
    const rawPct = clamp((clientX - rect.left) / rect.width, 0, 1);
    const spot = state.axisMin + rawPct * (state.axisMax - state.axisMin);
    return Number(spot.toFixed(2));
  }

  function applyDraggedSpot(clientX, source = 'top') {
    state.spot = pointerToSpot(clientX, source);
    els.spotInput.value = fmt(state.spot, 1);
    render();
    syncPriceLabelVisibility();
  }

  function startDrag(evt, source = 'top') {
    state.dragging = source;
    const x = evt.touches ? evt.touches[0].clientX : evt.clientX;
    applyDraggedSpot(x, source);
    evt.preventDefault();
  }

  function startDragFromTop(evt) {
    startDrag(evt, 'top');
  }

  function startDragFromChain(evt) {
    const x = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const rect = getDragTrackRect('chain');
    if (x < rect.left || x > rect.right) return;
    startDrag(evt, 'chain');
  }

  function duringDrag(evt) {
    if (!state.dragging) return;
    const x = evt.touches ? evt.touches[0].clientX : evt.clientX;
    applyDraggedSpot(x, state.dragging);
    evt.preventDefault();
  }

  function endDrag() {
    state.dragging = false;
  }

  function attachDrag() {
    const spotLine = $('#chain2dSpotLine');
    const spotHitbox = $('#chain2dSpotLine .spot-hitbox');
    const axisTracks = $$('.axis-track');

    if (spotLine) {
      spotLine.onmousedown = startDragFromTop;
      spotLine.ontouchstart = startDragFromTop;
    }

    if (spotHitbox) {
      spotHitbox.onmousedown = startDragFromTop;
      spotHitbox.ontouchstart = startDragFromTop;
    }

    if (els.stageSpotLine) {
      els.stageSpotLine.onmousedown = startDragFromChain;
      els.stageSpotLine.ontouchstart = startDragFromChain;
    }

    axisTracks.forEach((track) => {
      track.onmousedown = startDragFromChain;
      track.ontouchstart = startDragFromChain;
    });
  }

  [
    els.spotInput,
    els.daysInput,
    els.rateInput,
    els.volInput,
    els.minStrikeInput,
    els.maxStrikeInput
  ].forEach((el) => {
    el.addEventListener('change', render);
    el.addEventListener('blur', render);
    el.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        el.blur();
        render();
      }
    });
  });

  if (els.showPriceLabelsToggle) {
    els.showPriceLabelsToggle.addEventListener('change', syncPriceLabelVisibility);
  }

  window.addEventListener('mousemove', duringDrag, { passive: false });
  window.addEventListener('touchmove', duringDrag, { passive: false });
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);
  window.addEventListener('resize', () => {
    render();
    syncTutorialVisibility();
  });

  let wasActive = root.classList.contains('active');
  const activeObserver = new MutationObserver(() => {
    const isActive = root.classList.contains('active');
    if (isActive && !wasActive) {
      requestAnimationFrame(() => {
        render();
        syncTutorialVisibility();
      });
    } else {
      syncTutorialVisibility();
    }
    wasActive = isActive;
  });
  activeObserver.observe(root, { attributes: true, attributeFilter: ['class'] });

  render();
  syncTutorialVisibility();
})();




const state = {
      optionType: 'call',
      strike: 100,
      stockMin: 0,
      stockMax: 200,
      days: 90,
      rate: 4.5,
      vol: 45,
      stockPrice: 100,
      dragging: null,
      dragPointerId: null,
      dragSourceEl: null,
    };

    const defaults = { ...state };

    const els = {
      optionTypeSelect: document.getElementById('optionTypeSelect'),
      optionTypeTrigger: document.getElementById('optionTypeTrigger'),
      optionTypeLabel: document.getElementById('optionTypeLabel'),
      optionTypeMenu: document.getElementById('optionTypeMenu'),
      optionTypeOptions: document.querySelectorAll('.custom-select-option'),
      strikeInput: document.getElementById('strikeInput'),
      stockMinInput: document.getElementById('stockMinInput'),
      stockMaxInput: document.getElementById('stockMaxInput'),
      daysInput: document.getElementById('daysInput'),
      rateInput: document.getElementById('rateInput'),
      volInput: document.getElementById('volInput'),
      resetBtn: document.getElementById('resetBtn'),
      optionTrack: document.getElementById('optionTrack'),
      stockTrack: document.getElementById('stockTrack'),
      intrinsicFill: document.getElementById('intrinsicFill'),
      timeFill: document.getElementById('timeFill'),
      intrinsicValueDisplay: document.getElementById('intrinsicValueDisplay'),
      timeValueDisplay: document.getElementById('timeValueDisplay'),
      stockFill: document.getElementById('stockFill'),
      anchorLine: document.getElementById('anchorLine'),
      valueLinkLine: document.getElementById('valueLinkLine'),
      callPriceDisplay: document.getElementById('callPriceDisplay'),
      stockPriceInput: document.getElementById('stockPriceInput'),
      moneynessBadge: document.getElementById('moneynessBadge'),
      optionZeroTick: document.getElementById('optionZeroTick'),
      optionMaxTick: document.getElementById('optionMaxTick'),
      stockMinTick: document.getElementById('stockMinTick'),
      stockMaxTick: document.getElementById('stockMaxTick'),
      optionAxisTitle: document.getElementById('optionAxisTitle'),
      optionValueLabel: document.getElementById('optionValueLabel'),
      stockValueLabel: document.getElementById('stockValueLabel'),
    };

    function applyCalculatorModeClasses() {
      const calculatorView = document.getElementById('view-calculator');
      if (!calculatorView) return;
      calculatorView.classList.toggle('option-mode-call', state.optionType === 'call');
      calculatorView.classList.toggle('option-mode-put', state.optionType === 'put');
    }

    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
    function toMoney(v) { return `$${Number(v).toFixed(2)}`; }
    function toPct(v) { return `${Number(v).toFixed(2)}%`; }
    function toDisplayNumber(v) { return Number(v).toFixed(2); }
    function normalPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

    function americanOptionCRR(type, S, K, T, r, sigma, steps = 250, q = 0) {
      const exerciseValue = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      const lowerBound = exerciseValue;

      if (T <= 0 || sigma <= 0 || !Number.isFinite(S) || !Number.isFinite(K) || S <= 0 || K <= 0) {
        return {
          price: exerciseValue,
          intrinsic: exerciseValue,
          timeValue: 0,
          exerciseValue,
          lowerBound,
        };
      }

      const safeSteps = Math.max(25, Math.min(1000, Math.round(steps)));
      const dt = T / safeSteps;
      if (dt <= 0) {
        return {
          price: exerciseValue,
          intrinsic: exerciseValue,
          timeValue: 0,
          exerciseValue,
          lowerBound,
        };
      }

      const u = Math.exp(sigma * Math.sqrt(dt));
      const d = 1 / u;
      const growth = Math.exp((r - q) * dt);
      let p = (growth - d) / (u - d);
      p = clamp(p, 0, 1);
      const disc = Math.exp(-r * dt);

      const values = new Array(safeSteps + 1);

      for (let j = 0; j <= safeSteps; j++) {
        const stockAtNode = S * Math.pow(u, safeSteps - j) * Math.pow(d, j);
        values[j] = type === 'call'
          ? Math.max(stockAtNode - K, 0)
          : Math.max(K - stockAtNode, 0);
      }

      for (let step = safeSteps - 1; step >= 0; step--) {
        for (let j = 0; j <= step; j++) {
          const stockAtNode = S * Math.pow(u, step - j) * Math.pow(d, j);
          const continuation = disc * (p * values[j] + (1 - p) * values[j + 1]);
          const earlyExercise = type === 'call'
            ? Math.max(stockAtNode - K, 0)
            : Math.max(K - stockAtNode, 0);
          values[j] = Math.max(continuation, earlyExercise);
        }
      }

      const price = values[0];
      const intrinsic = exerciseValue;
      const timeValue = Math.max(price - intrinsic, 0);
      return { price, intrinsic, timeValue, exerciseValue, lowerBound };
    }

    function calibratedDisplayModel(type, S, K, T, r, sigma, steps = 250, q = 0) {
      const base = americanOptionCRR(type, S, K, T, r, sigma, steps, q);
      const intrinsic = base.intrinsic;
      const rawTime = Math.max(base.price - intrinsic, 0);

      if (T <= 0 || sigma <= 0 || !Number.isFinite(S) || !Number.isFinite(K) || S <= 0 || K <= 0) {
        return { ...base, price: intrinsic, timeValue: 0, rawPrice: base.price, rawTimeValue: rawTime };
      }

      const atmAnchor = americanOptionCRR(type, K, K, T, r, sigma, Math.max(steps, 180), q).price;
      const baseScale = Math.max(sigma * Math.sqrt(T) + 0.35, 0.18);
      const callDepth = Math.max(S - K, 0) / Math.max(K * baseScale, 1e-6);
      const putDepth = Math.max(K - S, 0) / Math.max(K * baseScale, 1e-6);

      let displayTime = rawTime;

      if (type === 'call' && S > K) {
        const callEnvelope = atmAnchor * Math.exp(-0.95 * Math.pow(callDepth, 0.92));
        displayTime = Math.min(rawTime, callEnvelope);
      }

      if (type === 'put' && S < K) {
        const putFloor = atmAnchor * 0.30 * Math.exp(-0.58 * Math.pow(putDepth, 0.90));
        displayTime = Math.max(rawTime, putFloor);
      }

      displayTime = Math.max(displayTime, 0);
      const displayPrice = intrinsic + displayTime;
      return {
        ...base,
        price: displayPrice,
        timeValue: displayTime,
        rawPrice: base.price,
        rawTimeValue: rawTime,
      };
    }

    function impliedVolFromPrice(type, targetPrice, S, K, T, r, q = 0) {
      const exerciseValue = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      const upperBound = type === 'call' ? Math.max(S, K) : Math.max(K, S);
      const cappedTarget = clamp(targetPrice, exerciseValue, upperBound);
      if (T <= 0 || cappedTarget <= exerciseValue + 1e-8) return 0.0001;

      let low = 0.0001;
      let high = 5.0;
      let mid = 0.25;
      for (let i = 0; i < 90; i++) {
        mid = (low + high) / 2;
        const price = calibratedDisplayModel(type, S, K, T, r, mid, 250, q).price;
        if (price > cappedTarget) high = mid;
        else low = mid;
      }
      return mid;
    }

    function getT() { return Math.max(0, Number(state.days)) / 365; }
    function getR() { return Number(state.rate) / 100; }
    function getSigma() { return Math.max(0.0001, Number(state.vol) / 100); }
    function currentModel() { return calibratedDisplayModel(state.optionType, state.stockPrice, state.strike, getT(), getR(), getSigma(), 250, 0); }

    function strikePercent() {
      if (state.stockMax <= state.stockMin) return 0;
      return clamp((state.strike - state.stockMin) / (state.stockMax - state.stockMin), 0, 1);
    }

    function spotPercent() {
      if (state.stockMax <= state.stockMin) return 0;
      return clamp((state.stockPrice - state.stockMin) / (state.stockMax - state.stockMin), 0, 1);
    }

    function trackRange() { return Math.max(state.stockMax - state.stockMin, 0.0001); }
    function optionLeftCapacity() { return Math.max(state.strike - state.stockMin, 0); }
    function optionRightCapacity() { return Math.max(state.stockMax - state.strike, 0); }
    function optionOffsetPercent(price) { return clamp(price / trackRange(), 0, 1); }

    function moneynessLabel(S, K, type) {
      const diff = type === 'call' ? S - K : K - S;
      if (Math.abs(S - K) <= Math.max(0.5, K * 0.005)) return 'ATM · 平值';
      return diff > 0 ? 'ITM · 价内' : 'OTM · 价外';
    }

    function applyStockPriceInput() {
      let stockPrice = Number(els.stockPriceInput.value);
      if (!Number.isFinite(stockPrice)) {
        els.stockPriceInput.value = toDisplayNumber(state.stockPrice);
        return;
      }
      state.stockPrice = clamp(stockPrice, state.stockMin, state.stockMax);
      render();
    }

    function syncInputs() {
      els.optionTypeLabel.textContent = state.optionType === 'put' ? 'Put' : 'Call';
      els.optionTypeOptions.forEach((option) => {
        const isActive = option.dataset.value === state.optionType;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      els.strikeInput.value = Number(state.strike).toFixed(0);
      els.stockMinInput.value = Number(state.stockMin).toFixed(0);
      els.stockMaxInput.value = Number(state.stockMax).toFixed(0);
      els.daysInput.value = Number(state.days).toFixed(0);
      els.rateInput.value = Number(state.rate).toFixed(2);
      els.volInput.value = Number(state.vol).toFixed(2);
      if (document.activeElement !== els.stockPriceInput) {
        els.stockPriceInput.value = toDisplayNumber(state.stockPrice);
      }
    }

    function updateModeText() {
      const isCall = state.optionType === 'call';
      applyCalculatorModeClasses();
      els.optionAxisTitle.textContent = isCall ? 'Call 价格' : 'Put 价格';
      els.optionValueLabel.textContent = '';
            const stockTitleEl = document.getElementById('stockAxisTitle');
      if (stockTitleEl) stockTitleEl.textContent = '标的价格';
      if (els.stockValueLabel) els.stockValueLabel.textContent = '';
    }

    function render() {
      updateModeText();
      const model = currentModel();
      const optionPrice = model.price;
      const intrinsic = model.intrinsic;
      const timeValue = model.timeValue;
      const strikeP = strikePercent();
      const spotP = spotPercent();
      const optionOffsetP = optionOffsetPercent(optionPrice);
      const intrinsicOffsetP = optionOffsetPercent(intrinsic);
      const timeOffsetP = optionOffsetPercent(timeValue);
      const isCall = state.optionType === 'call';

      els.callPriceDisplay.textContent = toDisplayNumber(optionPrice);
      if (document.activeElement !== els.stockPriceInput || state.dragging === 'stock') {
        els.stockPriceInput.value = toDisplayNumber(state.stockPrice);
      }
      els.moneynessBadge.textContent = moneynessLabel(state.stockPrice, state.strike, state.optionType);
      els.intrinsicValueDisplay.textContent = toMoney(intrinsic);
      els.timeValueDisplay.textContent = toMoney(timeValue);

      els.stockFill.style.width = `${spotP * 100}%`;
      els.anchorLine.style.left = `${strikeP * 100}%`;

      const intrinsicVisible = intrinsic > 0.0001;
      const linkPercent = intrinsicVisible ? spotP : strikeP;
      els.valueLinkLine.style.left = `${linkPercent * 100}%`;
      els.valueLinkLine.style.opacity = intrinsicVisible ? '1' : '0';

      els.optionZeroTick.style.left = `${strikeP * 100}%`;
      els.optionZeroTick.textContent = '$0.00';
      els.stockMinTick.textContent = toMoney(state.stockMin);
      els.stockMaxTick.textContent = toMoney(state.stockMax);

      if (isCall) {
        const intrinsicWidthP = Math.min(intrinsicOffsetP, Math.max(1 - strikeP, 0));
        const timeLeftP = clamp(strikeP + intrinsicWidthP, strikeP, 1);
        const timeWidthP = Math.min(timeOffsetP, Math.max(1 - timeLeftP, 0));
        els.intrinsicFill.style.left = `${strikeP * 100}%`;
        els.intrinsicFill.style.width = `${intrinsicWidthP * 100}%`;
        els.timeFill.style.left = `${timeLeftP * 100}%`;
        els.timeFill.style.width = `${timeWidthP * 100}%`;
        els.optionMaxTick.style.left = '';
        els.optionMaxTick.style.right = '0';
        els.optionMaxTick.textContent = toMoney(optionRightCapacity());
        els.optionMaxTick.style.transform = 'none';
      } else {
        const intrinsicWidthP = Math.min(intrinsicOffsetP, Math.max(strikeP, 0));
        const intrinsicLeftP = Math.max(strikeP - intrinsicWidthP, 0);
        const timeWidthP = Math.min(timeOffsetP, intrinsicLeftP);
        const timeLeftP = Math.max(intrinsicLeftP - timeWidthP, 0);
        els.intrinsicFill.style.left = `${intrinsicLeftP * 100}%`;
        els.intrinsicFill.style.width = `${intrinsicWidthP * 100}%`;
        els.timeFill.style.left = `${timeLeftP * 100}%`;
        els.timeFill.style.width = `${timeWidthP * 100}%`;
        els.optionMaxTick.style.right = '';
        els.optionMaxTick.style.left = '0';
        els.optionMaxTick.textContent = toMoney(optionLeftCapacity());
        els.optionMaxTick.style.transform = 'none';
      }
    }

    function applyInputState() {
      let strike = Number(els.strikeInput.value);
      let stockMin = Number(els.stockMinInput.value);
      let stockMax = Number(els.stockMaxInput.value);
      let days = Number(els.daysInput.value);
      let rate = Number(els.rateInput.value);
      let vol = Number(els.volInput.value);
      const optionType = state.optionType === 'put' ? 'put' : 'call';

      if (!Number.isFinite(strike)) strike = defaults.strike;
      if (!Number.isFinite(stockMin)) stockMin = defaults.stockMin;
      if (!Number.isFinite(stockMax)) stockMax = defaults.stockMax;
      if (!Number.isFinite(days)) days = defaults.days;
      if (!Number.isFinite(rate)) rate = defaults.rate;
      if (!Number.isFinite(vol)) vol = defaults.vol;

      if (stockMax <= stockMin) stockMax = stockMin + 1;
      days = Math.max(0, days);
      vol = Math.max(0.01, vol);

      state.optionType = optionType;
      state.strike = strike;
      state.stockMin = stockMin;
      state.stockMax = stockMax;
      state.days = days;
      state.rate = rate;
      state.vol = vol;
      state.stockPrice = clamp(state.stockPrice, state.stockMin, state.stockMax);

      syncInputs();
      render();
    }

    function positionToValue(clientX, trackEl, min, max) {
      const rect = trackEl.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return min + ratio * (max - min);
    }

    function handleStockPointer(clientX) {
      state.stockPrice = positionToValue(clientX, els.stockTrack, state.stockMin, state.stockMax);
      render();
    }

    function handleOptionPointer(clientX) {
      const mappedValue = positionToValue(clientX, els.optionTrack, state.stockMin, state.stockMax);
      const targetPrice = state.optionType === 'call'
        ? Math.max(mappedValue - state.strike, 0)
        : Math.max(state.strike - mappedValue, 0);
      const sigma = impliedVolFromPrice(state.optionType, targetPrice, state.stockPrice, state.strike, getT(), getR(), 0);
      state.vol = clamp(sigma * 100, 0.01, 500);
      syncInputs();
      render();
    }

    function startDrag(kind, event) {
      event.preventDefault();
      if (state.dragPointerId !== null) endDrag();
      state.dragging = kind;
      state.dragPointerId = event.pointerId;
      state.dragSourceEl = event.currentTarget;
      if (state.dragSourceEl && state.dragSourceEl.setPointerCapture) {
        try { state.dragSourceEl.setPointerCapture(event.pointerId); } catch (_) {}
      }
      if (kind === 'stock') handleStockPointer(event.clientX);
      else handleOptionPointer(event.clientX);
    }

    function endDrag(event) {
      if (event && state.dragPointerId !== null && event.pointerId !== state.dragPointerId) return;
      const sourceEl = state.dragSourceEl;
      const pointerId = state.dragPointerId;
      state.dragging = null;
      state.dragPointerId = null;
      state.dragSourceEl = null;
      if (sourceEl && sourceEl.releasePointerCapture && pointerId !== null) {
        try { sourceEl.releasePointerCapture(pointerId); } catch (_) {}
      }
    }

    els.stockTrack.addEventListener('pointerdown', (e) => startDrag('stock', e));
    els.optionTrack.addEventListener('pointerdown', (e) => startDrag('option', e));

    window.addEventListener('pointermove', (e) => {
      if (state.dragPointerId === null || e.pointerId !== state.dragPointerId) return;
      e.preventDefault();
      if (state.dragging === 'stock') handleStockPointer(e.clientX);
      if (state.dragging === 'option') handleOptionPointer(e.clientX);
    }, { passive: false });

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    els.stockTrack.addEventListener('lostpointercapture', endDrag);
    els.optionTrack.addEventListener('lostpointercapture', endDrag);

    [
      els.strikeInput,
      els.stockMinInput,
      els.stockMaxInput,
      els.daysInput,
      els.rateInput,
      els.volInput,
    ].forEach((input) => {
      input.addEventListener('change', applyInputState);
      input.addEventListener('blur', applyInputState);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyInputState();
      });
    });

    els.stockPriceInput.addEventListener('change', applyStockPriceInput);
    els.stockPriceInput.addEventListener('blur', applyStockPriceInput);
    els.stockPriceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyStockPriceInput();
        els.stockPriceInput.blur();
      }
    });

    function closeOptionTypeMenu() {
      els.optionTypeSelect.classList.remove('is-open');
      els.optionTypeTrigger.setAttribute('aria-expanded', 'false');
    }

    function openOptionTypeMenu() {
      els.optionTypeSelect.classList.add('is-open');
      els.optionTypeTrigger.setAttribute('aria-expanded', 'true');
    }

    els.optionTypeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (els.optionTypeSelect.classList.contains('is-open')) closeOptionTypeMenu();
      else openOptionTypeMenu();
    });

    els.optionTypeOptions.forEach((option) => {
      option.addEventListener('click', () => {
        state.optionType = option.dataset.value === 'put' ? 'put' : 'call';
        closeOptionTypeMenu();
        syncInputs();
        render();
      });
    });

    document.addEventListener('click', (e) => {
      if (!els.optionTypeSelect.contains(e.target)) closeOptionTypeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOptionTypeMenu();
    });

    els.resetBtn.addEventListener('click', () => {
      Object.assign(state, defaults);
      syncInputs();
      closeOptionTypeMenu();
      render();
    });

    window.addEventListener('resize', render);

    syncInputs();
    render();

document.addEventListener('DOMContentLoaded', () => {
  const tabs = Array.from(document.querySelectorAll('.tabs .tab[data-view]'));
  const guideBtn = document.getElementById('guideBtn');
  const guideModal = document.getElementById('guideModal');
  const guideModalBackdrop = document.getElementById('guideModalBackdrop');
  const guideModalClose = document.getElementById('guideModalClose');
  const views = {
    calculator: document.getElementById('view-calculator'),
    chain2d: document.getElementById('view-chain2d'),
    chain3d: document.getElementById('view-chain3d'),
  };

  const openGuideModal = () => {
    if (!guideModal) return;
    guideModal.classList.remove('is-hidden');
    guideModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  const closeGuideModal = () => {
    if (!guideModal) return;
    guideModal.classList.add('is-hidden');
    guideModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  guideBtn?.addEventListener('click', openGuideModal);
  guideModalClose?.addEventListener('click', closeGuideModal);
  guideModalBackdrop?.addEventListener('click', closeGuideModal);
  guideModal?.addEventListener('click', (event) => {
    if (event.target === guideModal) closeGuideModal();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && guideModal && !guideModal.classList.contains('is-hidden')) {
      closeGuideModal();
    }
  });

  function switchView(viewName) {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === viewName));
    Object.entries(views).forEach(([name, el]) => {
      if (!el) return;
      el.classList.toggle('active', name === viewName);
    });

    if (guideBtn) {
      const isChain3d = viewName === 'chain3d';
      guideBtn.style.display = isChain3d ? 'inline-flex' : 'none';
      if (!isChain3d) closeGuideModal();
    }

    if (viewName === 'chain3d') {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  switchView('calculator');
});




(() => {
  const DEG = 180 / Math.PI;

  document.addEventListener('DOMContentLoaded', () => {
    const view = document.getElementById('view-chain3d');
    const canvas = document.getElementById('chain3dCanvas');
    if (!view || !canvas) return;

    const ctx = canvas.getContext('2d');
    const bubble = document.getElementById('chain3dBubble');
    const topControls = document.getElementById('chain3dTopControls');
    const topToggleBtn = document.getElementById('chain3dTopToggle');
    const topDockBtn = document.getElementById('chain3dTopDock');
    const toggleBtn = document.getElementById('chain3dBubbleToggle');
    const dockBtn = document.getElementById('chain3dBubbleDock');
    const locatorBubble = document.getElementById('chain3dLocatorBubble');
    const locatorToggleBtn = document.getElementById('chain3dLocatorToggle');
    const locatorDockBtn = document.getElementById('chain3dLocatorDock');
    const locatorApplyBtn = document.getElementById('chain3dLocatorApplyBtn');
    const priceBoard = document.getElementById('chain3dPriceBoard');
    const priceBoardToggleBtn = document.getElementById('chain3dPriceBoardToggle');
    const priceBoardDockBtn = document.getElementById('chain3dPriceBoardDock');
    const bottomControls = document.getElementById('chain3dBottomControls');
    const pricePanel = document.getElementById('chain3dPricePanel');
    const priceToggleInput = document.getElementById('chain3dPriceToggle');
    const applyBtn = document.getElementById('chain3dApplyBtn');
    const viewReadout = document.getElementById('chain3dViewReadout');
    const overlayBlockSelector = [
      '#chain3dBubble',
      '#chain3dBubbleToggle',
      '#chain3dBubbleDock',
      '#chain3dTopControls',
      '#chain3dTopToggle',
      '#chain3dTopDock',
      '#chain3dLocatorBubble',
      '#chain3dLocatorToggle',
      '#chain3dLocatorDock',
      '#chain3dPriceBoard',
      '#chain3dPriceBoardToggle',
      '#chain3dPriceBoardDock'
    ].join(', ');

    const topInputs = {
      spot: document.getElementById('chain3dTopSpotInput'),
      spotValueInput: document.getElementById('chain3dTopSpotValueInput'),
      vol: document.getElementById('chain3dTopVolInput'),
      volValueInput: document.getElementById('chain3dTopVolValueInput'),
      volMax: document.getElementById('chain3dTopVolMaxInput'),
      elapsed: document.getElementById('chain3dTopElapsedInput'),
      elapsedValueInput: document.getElementById('chain3dTopElapsedValueInput'),
      spotMin: document.getElementById('chain3dTopSpotMin'),
      spotMax: document.getElementById('chain3dTopSpotMax'),
      volMaxTick: document.getElementById('chain3dTopVolMaxTick'),
      elapsedMax: document.getElementById('chain3dTopElapsedMax'),
    };
    const locatorInputs = {
      strike: document.getElementById('chain3dLocatorStrikeSelect'),
      month: document.getElementById('chain3dLocatorMonthSelect'),
    };
    const bottomInputs = {
      showGrid: document.getElementById('chain3dBottomShowGrid'),
    };

    const priceBoardOutputs = {
      price: document.getElementById('chain3dBoardPrice'),
      intrinsic: document.getElementById('chain3dBoardIntrinsic'),
      timeValue: document.getElementById('chain3dBoardTimeValue'),
      leverage: document.getElementById('chain3dBoardLeverage'),
      moneyness: document.getElementById('chain3dBoardMoneyness'),
      delta: document.getElementById('chain3dBoardDelta'),
      vega: document.getElementById('chain3dBoardVega'),
      theta: document.getElementById('chain3dBoardTheta'),
    };

    const inputs = {
      optionType: document.getElementById('chain3dOptionTypeInput'),
      spot: null,
      rate: document.getElementById('chain3dRateInput'),
      vol: null,
      volMax: null,
      volValueInput: null,
      minStrike: document.getElementById('chain3dMinStrikeInput'),
      maxStrike: document.getElementById('chain3dMaxStrikeInput'),
      maxDays: document.getElementById('chain3dMaxDaysInput'),
      steps: null,
      showNumbers: null,
    };

    const state = {
      yaw: 45 / DEG,
      pitch: -20 / DEG,
      roll: 0,
      offsetX: 15,
      offsetY: 45,
      zoom: 3,
      dragMode: null,
      pointerStartX: 0,
      pointerStartY: 0,
      collapsed: false,
      topCollapsed: false,
      locatorCollapsed: false,
      priceBoardCollapsed: false,
      locatorDisplayAuto: false,
      hoverMode: null,
      hoverStrike: null,
      hoverDays: null,
      lockedHoverMode: null,
      lockedHoverStrike: null,
      lockedHoverDays: null,
      interactions: { bars: [], frontStrikePoints: [], frontStrikeLabels: [], timeDayLabels: [], frontAxis: null },
      pricingParams: {
        optionType: 'call',
        spot: 100,
        rate: 4.5,
        vol: 45,
        volMax: 90,
        elapsed: 0,
        steps: 252,
        showNumbers: false,
        showGrid: true,
      },
      layoutParams: {
        minStrike: 60,
        maxStrike: 140,
        maxDays: 360,
      },
      layoutModel: null,
      barModel: null,
      pricePanelVisible: false,
      pricePanelChecked: false,
      pricePanelX: 0,
      pricePanelY: 0,
    };

    function clearTransientHoverIfNeeded() {
      if (hasLockedHover() || !state.hoverMode) return false;
      state.hoverMode = null;
      state.hoverStrike = null;
      state.hoverDays = null;
      return true;
    }

    function cancelCanvasInteraction() {
      const hadDrag = !!state.dragMode;
      state.dragMode = null;
      state.pointerDragDistance = 0;
      canvas.classList.remove('is-panning', 'is-rotating');
      return hadDrag;
    }

    function isPointerOverOverlayControls(clientX, clientY) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
      const el = document.elementFromPoint(clientX, clientY);
      return !!(el && el.closest(overlayBlockSelector));
    }

    function isOverlayControlEvent(event) {
      if (!event) return false;
      if (event.target && typeof event.target.closest === 'function' && event.target.closest(overlayBlockSelector)) {
        return true;
      }
      return isPointerOverOverlayControls(event.clientX, event.clientY);
    }

    let pricePanelDragActive = false;
    let pricePanelDragMoved = false;
    let pricePanelDragOffsetX = 0;
    let pricePanelDragOffsetY = 0;

    const STRIKE_STEP = 5;
    const DAY_STEP = 30;
    const BASE_DISTANCE = 560;
    const DEPTH_SHIFT = 420;
    const PITCH_LIMIT = 1.18;
    const ROLL_LIMIT = 1.18;
    const X_UNIT = 18;
    const Y_UNIT = 28;
    const MAX_BAR_HEIGHT = 90;
    const PLANE_PAD = 20;

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function nice(value, step = 5) {
      return Math.round(value / step) * step;
    }

    function setInputValueIfIdle(input, value) {
      if (!input) return;
      if (document.activeElement === input) return;
      input.value = String(value);
    }

    function formatVolDisplay(value) {
      return Number(value).toFixed(1).replace(/\.0$/, '');
    }


    function formatBoardNumber(value, digits = 2) {
      if (!Number.isFinite(value)) return '--';
      return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    }

    function formatBoardGreek(value) {
      if (!Number.isFinite(value)) return '--';
      return Number(value).toFixed(4);
    }

    function setBoardValue(el, value) {
      if (!el) return;
      el.textContent = value;
    }

    function getNodeForActiveConcreteHover() {
      const activeHover = getActiveHover();
      if (!activeHover.mode || activeHover.mode !== 'bar') return null;
      const nodes = state.barModel?.nodes || [];
      return nodes.find((node) => node.K === activeHover.strike && node.days === activeHover.days) || null;
    }

    function formatBoardMoneyness(type, S, K) {
      const diff = type === 'put' ? K - S : S - K;
      if (Math.abs(S - K) <= Math.max(0.5, K * 0.005)) return 'ATM · 平值';
      return diff > 0 ? 'ITM · 实值' : 'OTM · 虚值';
    }

    function computeGreekMetricsForNode(node) {
      if (!node) return null;
      const type = state.pricingParams.optionType === 'put' ? 'put' : 'call';
      const S = Number(state.pricingParams.spot) || 0;
      const K = Number(node.K) || 0;
      const T = Math.max(0, Number(node.effectiveDays || 0) / 365);
      const r = (Number(state.pricingParams.rate) || 0) / 100;
      const sigma = Math.max(0.0001, (Number(state.pricingParams.vol) || 0) / 100);
      const steps = Number(state.pricingParams.steps) || 220;
      const price = Number(node.price) || 0;
      const hS = Math.max(0.5, S * 0.01);
      const hSigma = 0.01;
      const dayStep = 1 / 365;

      const upS = americanOptionCRR(type, Math.max(0.01, S + hS), K, T, r, sigma, steps).price;
      const dnS = americanOptionCRR(type, Math.max(0.01, S - hS), K, T, r, sigma, steps).price;
      const delta = (upS - dnS) / (2 * hS);
      const gamma = (upS - (2 * price) + dnS) / (hS * hS);

      const upVol = americanOptionCRR(type, S, K, T, r, sigma + hSigma, steps).price;
      const dnVol = americanOptionCRR(type, S, K, T, r, Math.max(0.0001, sigma - hSigma), steps).price;
      const vega = ((upVol - dnVol) / (2 * hSigma)) * 0.01;

      let theta;
      if (T > dayStep) {
        const shorter = americanOptionCRR(type, S, K, T - dayStep, r, sigma, steps).price;
        theta = shorter - price;
      } else {
        const expiry = americanOptionCRR(type, S, K, 0, r, sigma, steps).price;
        theta = expiry - price;
      }

      const leverage = Math.abs(price) > 1e-8 ? (delta * S) / price : NaN;
      return { price, intrinsic: Number(node.intrinsic) || 0, timeValue: Number(node.timeValue) || 0, leverage, delta, gamma, vega, theta };
    }

    function updatePriceBoardReadout() {
      const metrics = computeGreekMetricsForNode(getNodeForActiveConcreteHover());
      if (!metrics) {
        Object.values(priceBoardOutputs).forEach((el) => setBoardValue(el, '--'));
        return;
      }
      setBoardValue(priceBoardOutputs.price, formatBoardNumber(metrics.price, 2));
      setBoardValue(priceBoardOutputs.intrinsic, formatBoardNumber(metrics.intrinsic, 2));
      setBoardValue(priceBoardOutputs.timeValue, formatBoardNumber(metrics.timeValue, 2));
      setBoardValue(priceBoardOutputs.leverage, formatBoardNumber(metrics.leverage, 2));
      setBoardValue(priceBoardOutputs.moneyness, formatBoardMoneyness(state.pricingParams.optionType, Number(state.pricingParams.spot) || 0, Number(getNodeForActiveConcreteHover()?.K) || 0));
      setBoardValue(priceBoardOutputs.delta, formatBoardGreek(metrics.delta));
      setBoardValue(priceBoardOutputs.vega, formatBoardGreek(metrics.vega));
      setBoardValue(priceBoardOutputs.theta, formatBoardGreek(metrics.theta));
    }

    function updateVolSliderVisual() {
      if (!inputs.vol) return;
      const min = Number(inputs.vol.min || 15);
      const max = Number(inputs.vol.max || state.pricingParams.volMax || 90);
      const value = Number(inputs.vol.value || state.pricingParams.vol || min);
      const span = Math.max(max - min, 0.0001);
      const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
      inputs.vol.style.setProperty('--fill-pct', `${pct}%`);
    }

    function updateTopSliderVisual(input) {
      if (!input) return;
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const value = Number(input.value || min);
      const span = Math.max(max - min, 0.0001);
      const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
      input.style.setProperty('--fill-pct', `${pct}%`);
    }

    function syncTopControls() {
      if (!topInputs.spot || !topInputs.vol || !topInputs.elapsed) return;
      const minStrike = Number(state.layoutParams.minStrike) || 60;
      const maxStrike = Number(state.layoutParams.maxStrike) || 140;
      const maxDays = Number(state.layoutParams.maxDays) || 360;

      topInputs.spot.min = String(minStrike);
      topInputs.spot.max = String(maxStrike);
      if (topInputs.spotValueInput) {
        topInputs.spotValueInput.min = String(minStrike);
        topInputs.spotValueInput.max = String(maxStrike);
      }
      const currentSpot = clamp(Number(topInputs.spot.value || topInputs.spotValueInput?.value || state.pricingParams.spot || minStrike), minStrike, maxStrike);
      topInputs.spot.value = String(currentSpot);
      if (topInputs.spotValueInput && document.activeElement !== topInputs.spotValueInput) topInputs.spotValueInput.value = String(Math.round(currentSpot));
      if (topInputs.spotMin) topInputs.spotMin.textContent = String(Math.round(minStrike));
      if (topInputs.spotMax) topInputs.spotMax.textContent = String(Math.round(maxStrike));
      updateTopSliderVisual(topInputs.spot);

      const currentVolMax = Math.max(15, Number(topInputs.volMax?.value || state.pricingParams.volMax || 90));
      state.pricingParams.volMax = currentVolMax;
      if (topInputs.volMax && document.activeElement !== topInputs.volMax) topInputs.volMax.value = String(Math.round(currentVolMax));
      topInputs.vol.min = '15';
      topInputs.vol.max = String(currentVolMax);
      if (topInputs.volValueInput) {
        topInputs.volValueInput.min = '15';
        topInputs.volValueInput.max = String(currentVolMax);
      }
      const currentVol = clamp(Number(topInputs.vol.value || topInputs.volValueInput?.value || state.pricingParams.vol || 45), 15, currentVolMax);
      state.pricingParams.vol = currentVol;
      topInputs.vol.value = String(currentVol);
      if (topInputs.volValueInput && document.activeElement !== topInputs.volValueInput) topInputs.volValueInput.value = formatVolDisplay(currentVol);
      if (topInputs.volMaxTick) topInputs.volMaxTick.textContent = String(Math.round(currentVolMax));
      updateTopSliderVisual(topInputs.vol);

      topInputs.elapsed.min = '0';
      topInputs.elapsed.max = String(maxDays);
      if (topInputs.elapsedValueInput) {
        topInputs.elapsedValueInput.min = '0';
        topInputs.elapsedValueInput.max = String(maxDays);
      }
      const currentElapsed = clamp(Number(topInputs.elapsed.value || topInputs.elapsedValueInput?.value || state.pricingParams.elapsed || 0), 0, maxDays);
      state.pricingParams.elapsed = currentElapsed;
      topInputs.elapsed.value = String(currentElapsed);
      if (topInputs.elapsedValueInput && document.activeElement !== topInputs.elapsedValueInput) topInputs.elapsedValueInput.value = String(Math.round(currentElapsed));
      if (topInputs.elapsedMax) topInputs.elapsedMax.textContent = String(Math.round(maxDays));
      updateTopSliderVisual(topInputs.elapsed);
    }

    function setSelectOptions(select, options, preferredValue) {
      if (!select) return;
      const current = preferredValue != null ? String(preferredValue) : String(select.value || '');
      const normalizedOptions = [{ value: '', label: '--' }, ...options.filter((opt) => String(opt.value) !== '')];
      select.innerHTML = normalizedOptions.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('');
      const values = new Set(normalizedOptions.map((opt) => String(opt.value)));
      if (values.has(current)) {
        select.value = current;
      } else {
        select.value = '';
      }
    }

    function resetLocatorSelection(markAuto = false) {
      if (!locatorInputs.strike || !locatorInputs.month) return;
      locatorInputs.strike.value = '';
      locatorInputs.month.value = '';
      state.locatorDisplayAuto = !!markAuto;
    }

    function syncLocatorOptions() {
      if (!locatorInputs.strike || !locatorInputs.month) return;
      const minStrike = Number(state.layoutParams.minStrike) || 60;
      const maxStrike = Number(state.layoutParams.maxStrike) || 140;
      const maxDays = Number(state.layoutParams.maxDays) || 360;

      const strikeOptions = [];
      for (let strike = minStrike; strike <= maxStrike; strike += STRIKE_STEP) {
        strikeOptions.push({ value: String(strike), label: String(strike) });
      }

      const monthOptions = [];
      for (let days = DAY_STEP; days <= maxDays; days += DAY_STEP) {
        const months = Math.round(days / DAY_STEP);
        monthOptions.push({ value: String(days), label: `${months}个月` });
      }

      setSelectOptions(locatorInputs.strike, strikeOptions, locatorInputs.strike.value);
      setSelectOptions(locatorInputs.month, monthOptions, locatorInputs.month.value);
    }

    function syncInputs() {
      const volMax = Math.max(15, Number(state.pricingParams.volMax) || 90);
      const volValue = clamp(Number(state.pricingParams.vol) || 90, 15, volMax);
      state.pricingParams.volMax = volMax;
      state.pricingParams.vol = volValue;
      if (inputs.optionType && document.activeElement !== inputs.optionType) inputs.optionType.value = state.pricingParams.optionType === 'put' ? 'put' : 'call';
      setInputValueIfIdle(inputs.rate, state.pricingParams.rate);
      setInputValueIfIdle(inputs.minStrike, state.layoutParams.minStrike);
      setInputValueIfIdle(inputs.maxStrike, state.layoutParams.maxStrike);
      setInputValueIfIdle(inputs.maxDays, state.layoutParams.maxDays);
      if (bottomInputs.showGrid) bottomInputs.showGrid.checked = state.pricingParams.showGrid !== false;
      if (priceToggleInput) priceToggleInput.checked = !!state.pricePanelChecked;
      syncTopControls();
      syncLocatorOptions();
    }

    function pullPricingParamsFromInputs(syncAfter = true) {
      const p = state.pricingParams;
      const rate = Number(inputs.rate?.value);
      const optionType = inputs.optionType?.value === 'put' ? 'put' : 'call';
      p.optionType = optionType;
      p.rate = Number.isFinite(rate) ? rate : p.rate;
      p.steps = 252;
      if (syncAfter) syncInputs();
    }

    function pullLayoutParamsFromInputs(syncAfter = true) {
      const p = state.layoutParams;
      const minStrike = nice(Number(inputs.minStrike.value) || p.minStrike, STRIKE_STEP);
      const maxStrike = nice(Number(inputs.maxStrike.value) || p.maxStrike, STRIKE_STEP);
      const maxDays = Math.max(DAY_STEP, nice(Number(inputs.maxDays.value) || p.maxDays, DAY_STEP));
      p.minStrike = Math.min(minStrike, maxStrike);
      p.maxStrike = Math.max(minStrike, maxStrike);
      p.maxDays = maxDays;
      if (syncAfter) syncInputs();
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function rotatePoint(point) {
      const pivot = currentPivot || { x: 0, y: 0, z: 0 };
      let x = point.x - pivot.x;
      let y = point.y - pivot.y;
      let z = point.z - pivot.z;

      const cosYaw = Math.cos(state.yaw);
      const sinYaw = Math.sin(state.yaw);
      const yawX = x * cosYaw + z * sinYaw;
      const yawZ = -x * sinYaw + z * cosYaw;
      x = yawX;
      z = yawZ;

      const cosPitch = Math.cos(state.pitch);
      const sinPitch = Math.sin(state.pitch);
      const pitchY = y * cosPitch - z * sinPitch;
      const pitchZ = y * sinPitch + z * cosPitch;
      y = pitchY;
      z = pitchZ;

      const cosRoll = Math.cos(state.roll);
      const sinRoll = Math.sin(state.roll);
      const rollX = x * cosRoll - y * sinRoll;
      const rollY = x * sinRoll + y * cosRoll;
      x = rollX;
      y = rollY;

      return { x: x + pivot.x, y: y + pivot.y, z: z + pivot.z };
    }

    function projectPoint(point, rect) {
      const rotated = rotatePoint(point);
      const perspective = BASE_DISTANCE / (BASE_DISTANCE + rotated.z + DEPTH_SHIFT);
      const centerX = rect.width / 2 + state.offsetX;
      const centerY = rect.height / 2 + state.offsetY;
      return {
        x: centerX + rotated.x * perspective * state.zoom,
        y: centerY - rotated.y * perspective * state.zoom,
        scale: perspective * state.zoom,
        depth: rotated.z,
      };
    }

    function subtract(a, b) {
      return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    function cross(a, b) {
      return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
      };
    }

    function dot(a, b) {
      return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    function add(a, b) {
      return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    function scale(v, s) {
      return { x: v.x * s, y: v.y * s, z: v.z * s };
    }

    function normalize(v) {
      const len = Math.hypot(v.x, v.y, v.z) || 1;
      return { x: v.x / len, y: v.y / len, z: v.z / len };
    }

    function clamp01(v) {
      return Math.min(1, Math.max(0, v));
    }

    function drawGridBackdrop(rect) {
      ctx.save();
      const centerX = rect.width / 2 + state.offsetX;
      const centerY = rect.height / 2 + state.offsetY;
      const radius = Math.max(rect.width, rect.height) * 0.72;
      const grad = ctx.createRadialGradient(centerX, centerY - 50, 0, centerX, centerY, radius);
      grad.addColorStop(0, 'rgba(77, 132, 194, 0.10)');
      grad.addColorStop(0.5, 'rgba(32, 66, 112, 0.04)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, rect.width, rect.height);
      {
        const spacing = 32;
        ctx.strokeStyle = 'rgba(104, 146, 198, 0.08)';
        ctx.lineWidth = 1;
        for (let x = spacing / 2; x < rect.width; x += spacing) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
        }
        for (let y = spacing / 2; y < rect.height; y += spacing) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke();
        }
      }
      ctx.restore();
    }

    function drawSegment3D(a, b, strokeStyle, lineWidth, rect, dash = []) {
      const pa = projectPoint(a, rect);
      const pb = projectPoint(b, rect);
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.restore();
      return { pa, pb };
    }

    function drawTextAt(point, text, rect, options = {}) {
      const p = projectPoint(point, rect);
      ctx.save();
      ctx.font = options.font || '600 11px Inter, system-ui, sans-serif';
      ctx.textAlign = options.align || 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = options.color || 'rgba(219, 231, 250, 0.82)';
      if (options.shadow) {
        ctx.shadowColor = options.shadow;
        ctx.shadowBlur = 8;
      }
      ctx.fillText(text, p.x + (options.dx || 0), p.y + (options.dy || 0));
      ctx.restore();
    }

    function pointToSegmentDistance(px, py, ax, ay, bx, by) {
      const abx = bx - ax;
      const aby = by - ay;
      const apx = px - ax;
      const apy = py - ay;
      const denom = abx * abx + aby * aby || 1;
      const t = clamp((apx * abx + apy * aby) / denom, 0, 1);
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      return { distance: Math.hypot(px - cx, py - cy), t, x: cx, y: cy };
    }

    function rectContains(rect, x, y, pad = 0) {
      return x >= rect.minX - pad && x <= rect.maxX + pad && y >= rect.minY - pad && y <= rect.maxY + pad;
    }

    function hasLockedHover() {
      return !!state.lockedHoverMode;
    }

    function getActiveHover() {
      if (state.lockedHoverMode) {
        return { mode: state.lockedHoverMode, strike: state.lockedHoverStrike, days: state.lockedHoverDays, locked: true };
      }
      return { mode: state.hoverMode, strike: state.hoverStrike, days: state.hoverDays, locked: false };
    }

    function syncPricePanelUI() {
      if (!pricePanel || !view) return;
      if (!state.pricePanelVisible || !hasLockedHover()) {
        pricePanel.classList.remove('is-visible', 'is-dragging');
        pricePanel.style.left = '';
        pricePanel.style.top = '';
        if (priceToggleInput) priceToggleInput.checked = !!state.pricePanelChecked;
        return;
      }
      pricePanel.classList.add('is-visible');
      const margin = 12;
      const fallbackWidth = 126;
      const fallbackHeight = 42;
      const panelWidth = pricePanel.offsetWidth || fallbackWidth;
      const panelHeight = pricePanel.offsetHeight || fallbackHeight;
      const maxX = Math.max(margin, view.clientWidth - panelWidth - margin);
      const maxY = Math.max(margin, view.clientHeight - panelHeight - margin);
      const left = clamp(state.pricePanelX, margin, maxX);
      const top = clamp(state.pricePanelY, margin, maxY);
      pricePanel.style.left = `${Math.round(left)}px`;
      pricePanel.style.top = `${Math.round(top)}px`;
      if (priceToggleInput) priceToggleInput.checked = !!state.pricePanelChecked;
    }

    function startPricePanelDrag(event) {
      if (!pricePanel || !view || !state.pricePanelVisible || !hasLockedHover()) return;
      if (event.button !== 0) return;
      if (event.target === priceToggleInput) return;
      const panelRect = pricePanel.getBoundingClientRect();
      pricePanelDragActive = true;
      pricePanelDragMoved = false;
      pricePanelDragOffsetX = event.clientX - panelRect.left;
      pricePanelDragOffsetY = event.clientY - panelRect.top;
      pricePanel.classList.add('is-dragging');
      event.preventDefault();
      event.stopPropagation();
    }

    function movePricePanelDrag(event) {
      if (!pricePanelDragActive || !pricePanel || !view) return;
      const viewRect = view.getBoundingClientRect();
      const nextX = event.clientX - viewRect.left - pricePanelDragOffsetX;
      const nextY = event.clientY - viewRect.top - pricePanelDragOffsetY;
      if (!pricePanelDragMoved) {
        const dx = nextX - state.pricePanelX;
        const dy = nextY - state.pricePanelY;
        if (Math.hypot(dx, dy) > 2) pricePanelDragMoved = true;
      }
      state.pricePanelX = nextX;
      state.pricePanelY = nextY;
      syncPricePanelUI();
    }

    function endPricePanelDrag() {
      if (!pricePanelDragActive) return;
      pricePanelDragActive = false;
      if (pricePanel) pricePanel.classList.remove('is-dragging');
      if (pricePanelDragMoved) {
        window.setTimeout(() => {
          pricePanelDragMoved = false;
        }, 0);
      }
    }

    function hidePricePanel() {
      state.pricePanelVisible = false;
      state.pricePanelChecked = false;
      pricePanelDragActive = false;
      pricePanelDragMoved = false;
      if (pricePanel) pricePanel.classList.remove('is-dragging');
      syncPricePanelUI();
    }

    function showPricePanelForCurrentLock(event = null) {
      if (!pricePanel || !view) return;
      const viewRect = view.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const panelWidth = pricePanel.offsetWidth || 126;
      const panelHeight = pricePanel.offsetHeight || 42;
      const localMouseX = event ? (event.clientX - viewRect.left) : Math.round(view.clientWidth * 0.5);
      const localMouseY = event ? (event.clientY - viewRect.top) : Math.round(view.clientHeight * 0.5);
      let left = localMouseX + 18;
      let top = localMouseY - 20;

      if (state.lockedHoverMode === 'strike') {
        left = localMouseX - panelWidth - 18;
        top = localMouseY - Math.round(panelHeight * 0.5);
      } else if (state.lockedHoverMode === 'day') {
        left = localMouseX + 18;
        top = localMouseY - Math.round(panelHeight * 0.5);
      } else if (state.lockedHoverMode === 'bar') {
        const matchedBar = (state.interactions.bars || []).find((item) => item.K === state.lockedHoverStrike && item.days === state.lockedHoverDays);
        if (matchedBar) {
          left = (canvasRect.left - viewRect.left) + matchedBar.center2d.x + 24;
          top = (canvasRect.top - viewRect.top) + matchedBar.center2d.y - panelHeight - 14;
        } else {
          left = localMouseX + 20;
          top = localMouseY - panelHeight - 14;
        }
      }

      state.pricePanelVisible = true;
      state.pricePanelChecked = false;
      state.pricePanelX = left;
      state.pricePanelY = top;
      syncPricePanelUI();
      requestAnimationFrame(syncPricePanelUI);
    }

    function syncLocatorSelectionFromConcreteHover(strike, days) {
      if (!locatorInputs.strike || !locatorInputs.month) return;
      const strikeValue = String(strike);
      const dayValue = String(days);
      const strikeExists = Array.from(locatorInputs.strike.options || []).some((option) => option.value === strikeValue);
      const dayExists = Array.from(locatorInputs.month.options || []).some((option) => option.value === dayValue);
      if (strikeExists) locatorInputs.strike.value = strikeValue;
      if (dayExists) locatorInputs.month.value = dayValue;
      state.locatorDisplayAuto = true;
    }

    function syncLocatorSelectionFromActiveHover() {
      const activeHover = getActiveHover();
      if (activeHover.mode === 'bar' && Number.isFinite(activeHover.strike) && Number.isFinite(activeHover.days)) {
        syncLocatorSelectionFromConcreteHover(activeHover.strike, activeHover.days);
        return;
      }
      if (state.locatorDisplayAuto) {
        resetLocatorSelection(false);
      }
    }

    function setLockedHoverFromCurrent(event) {
      if (!state.hoverMode || hasLockedHover()) return false;
      state.lockedHoverMode = state.hoverMode;
      state.lockedHoverStrike = state.hoverStrike;
      state.lockedHoverDays = state.hoverDays;
      if (state.lockedHoverMode === 'bar' && Number.isFinite(state.lockedHoverStrike) && Number.isFinite(state.lockedHoverDays)) {
        syncLocatorSelectionFromConcreteHover(state.lockedHoverStrike, state.lockedHoverDays);
      } else {
        resetLocatorSelection(false);
      }
      showPricePanelForCurrentLock(event);
      return true;
    }

    function clearLockedHover(clearTransient = false) {
      const hadLock = !!state.lockedHoverMode;
      state.lockedHoverMode = null;
      state.lockedHoverStrike = null;
      state.lockedHoverDays = null;
      hidePricePanel();
      if (hadLock && state.locatorDisplayAuto) resetLocatorSelection(false);
      if (clearTransient) {
        state.hoverMode = null;
        state.hoverStrike = null;
        state.hoverDays = null;
      }
      return hadLock;
    }

    function applyLocatorSelection() {
      const strike = Number(locatorInputs.strike?.value);
      const days = Number(locatorInputs.month?.value);
      if (!Number.isFinite(strike) || !Number.isFinite(days)) return false;
      state.lockedHoverMode = 'bar';
      state.lockedHoverStrike = strike;
      state.lockedHoverDays = days;
      state.hoverMode = null;
      state.hoverStrike = null;
      state.hoverDays = null;
      draw();
      requestAnimationFrame(() => {
        showPricePanelForCurrentLock();
      });
      return true;
    }

    function computeHoverAt(clientX, clientY) {
      if (!currentRect || state.dragMode || hasLockedHover()) return false;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let nextMode = null;
      let nextStrike = null;
      let nextDays = null;

      let nearestStrikeLabel = null;
      if (state.interactions.frontStrikeLabels && state.interactions.frontStrikeLabels.length) {
        for (const label of state.interactions.frontStrikeLabels) {
          if (!rectContains(label.bbox, x, y, 4)) continue;
          const d = Math.hypot(x - label.center.x, y - label.center.y);
          if (!nearestStrikeLabel || d < nearestStrikeLabel.d) nearestStrikeLabel = { label, d };
        }
      }

      let nearestDayLabel = null;
      if (!nearestStrikeLabel && state.interactions.timeDayLabels && state.interactions.timeDayLabels.length) {
        for (const label of state.interactions.timeDayLabels) {
          if (!rectContains(label.bbox, x, y, 4)) continue;
          const d = Math.hypot(x - label.center.x, y - label.center.y);
          if (!nearestDayLabel || d < nearestDayLabel.d) nearestDayLabel = { label, d };
        }
      }

      if (nearestStrikeLabel) {
        nextMode = 'strike';
        nextStrike = nearestStrikeLabel.label.K;
      } else if (nearestDayLabel) {
        nextMode = 'day';
        nextDays = nearestDayLabel.label.days;
      } else {
        let best = null;
        for (const item of state.interactions.bars) {
          if (!rectContains(item.bbox, x, y, 2)) continue;
          const d = Math.hypot(x - item.center2d.x, y - item.center2d.y);
          const score = item.depth * 1000 - d;
          if (!best || score > best.score) best = { item, score };
        }
        if (best) {
          nextMode = 'bar';
          nextStrike = best.item.K;
          nextDays = best.item.days;
        }
      }

      const changed = nextMode !== state.hoverMode || nextStrike !== state.hoverStrike || nextDays !== state.hoverDays;
      state.hoverMode = nextMode;
      state.hoverStrike = nextStrike;
      state.hoverDays = nextDays;
      return changed;
    }

    function americanOptionCRR(type, S, K, T, r, sigma, steps = 220, q = 0) {
      const exerciseValue = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      if (T <= 0 || sigma <= 0 || !Number.isFinite(S) || !Number.isFinite(K) || S <= 0 || K <= 0) {
        return { price: exerciseValue, intrinsic: exerciseValue, timeValue: 0 };
      }
      const safeSteps = Math.max(25, Math.min(1000, Math.round(steps)));
      const dt = T / safeSteps;
      const u = Math.exp(sigma * Math.sqrt(dt));
      const d = 1 / u;
      const growth = Math.exp((r - q) * dt);
      let p = (growth - d) / (u - d);
      p = clamp(p, 0, 1);
      const disc = Math.exp(-r * dt);
      const values = new Array(safeSteps + 1);
      for (let j = 0; j <= safeSteps; j++) {
        const stockAtNode = S * Math.pow(u, safeSteps - j) * Math.pow(d, j);
        values[j] = type === 'call' ? Math.max(stockAtNode - K, 0) : Math.max(K - stockAtNode, 0);
      }
      for (let step = safeSteps - 1; step >= 0; step--) {
        for (let j = 0; j <= step; j++) {
          const stockAtNode = S * Math.pow(u, step - j) * Math.pow(d, j);
          const continuation = disc * (p * values[j] + (1 - p) * values[j + 1]);
          const earlyExercise = type === 'call' ? Math.max(stockAtNode - K, 0) : Math.max(K - stockAtNode, 0);
          values[j] = Math.max(continuation, earlyExercise);
        }
      }
      const price = values[0];
      const intrinsic = exerciseValue;
      const timeValue = Math.max(price - intrinsic, 0);
      return { price, intrinsic, timeValue };
    }

    function buildLayoutModel() {
      const p = state.layoutParams;
      const strikeTicks = [];
      for (let k = p.minStrike; k <= p.maxStrike; k += STRIKE_STEP) strikeTicks.push(k);
      const dayTicks = [];
      for (let d = 0; d <= p.maxDays; d += DAY_STEP) dayTicks.push(d);

      const xMin = ((p.minStrike - 100) / STRIKE_STEP) * X_UNIT;
      const xMax = ((p.maxStrike - 100) / STRIKE_STEP) * X_UNIT;
      const zMin = 0;
      const zMax = (p.maxDays / DAY_STEP) * Y_UNIT;

      const planeX0 = xMin - PLANE_PAD;
      const planeX1 = xMax + PLANE_PAD;
      const planeZ0 = zMin;
      const planeZ1 = zMax + PLANE_PAD;

      return {
        strikeTicks,
        dayTicks,
        xMin,
        xMax,
        zMin,
        zMax,
        planeX0,
        planeX1,
        planeZ0,
        planeZ1,
        pivot: {
          x: (planeX0 + planeX1) * 0.5,
          y: 0,
          z: (planeZ0 + planeZ1) * 0.5,
        },
        zScale: null,
      };
    }

function buildBarModel(layoutModel) {
  const p = state.pricingParams;
  const nodes = [];
  const grid = [];
  const dataDayTicks = layoutModel.dayTicks.filter((days) => days > 0);
  const elapsedDays = clamp(Number(p.elapsed) || 0, 0, state.layoutParams.maxDays || 360);
  let maxPrice = 0;
  layoutModel.strikeTicks.forEach((K) => {
    const row = [];
    dataDayTicks.forEach((days) => {
      const effectiveDays = Math.max(days - elapsedDays, 0);
      const T = effectiveDays / 365;
      const option = americanOptionCRR(p.optionType === 'put' ? 'put' : 'call', p.spot, K, T, p.rate / 100, p.vol / 100, p.steps);
      maxPrice = Math.max(maxPrice, option.price);
      const node = { K, days, effectiveDays, x: strikeToX(K), z: daysToZ(days), ...option };
      row.push(node);
      nodes.push(node);
    });
    grid.push(row);
  });

  return { nodes, grid, maxPrice, dataDayTicks };
}

function setLayoutScaleFromBarModel(layoutModel, barModel) {
      layoutModel.zScale = barModel.maxPrice > 0 ? MAX_BAR_HEIGHT / barModel.maxPrice : 1;
    }

    function pruneHoverAgainstLayout(layoutModel) {
      const strikeSet = new Set(layoutModel.strikeTicks);
      const daySet = new Set(layoutModel.dayTicks.filter((days) => days > 0));
      const hoverStrikeValid = state.hoverStrike == null || strikeSet.has(state.hoverStrike);
      const hoverDaysValid = state.hoverDays == null || daySet.has(state.hoverDays);
      const lockedStrikeValid = state.lockedHoverStrike == null || strikeSet.has(state.lockedHoverStrike);
      const lockedDaysValid = state.lockedHoverDays == null || daySet.has(state.lockedHoverDays);

      if (!hoverStrikeValid || !hoverDaysValid) {
        state.hoverMode = null;
        state.hoverStrike = null;
        state.hoverDays = null;
      }
      if (!lockedStrikeValid || !lockedDaysValid) {
        clearLockedHover();
      }
    }

    function ensureModelCache() {
      if (!state.layoutModel) state.layoutModel = buildLayoutModel();
      if (!state.barModel) state.barModel = buildBarModel(state.layoutModel);
      if (!(Number.isFinite(state.layoutModel.zScale) && state.layoutModel.zScale > 0)) {
        setLayoutScaleFromBarModel(state.layoutModel, state.barModel);
      }
      if (!currentPivot) currentPivot = state.layoutModel.pivot;
    }

    function buildModel() {
      ensureModelCache();
      return {
        ...state.layoutModel,
        ...state.barModel,
        zScale: state.layoutModel.zScale,
      };
    }

    function getPillarSectionsForNode(node, model) {
      const sections = [];
      const yIntrinsic = priceToY(node.intrinsic, model.zScale);
      const yPrice = priceToY(node.price, model.zScale);
      if (yIntrinsic > 0.0001) {
        sections.push({ y0: 0, y1: yIntrinsic, isBase: true });
      }
      if (yPrice > yIntrinsic + 0.0001) {
        sections.push({ y0: yIntrinsic, y1: yPrice, isBase: sections.length === 0 });
      }
      if (!sections.length && yPrice > 0.0001) {
        sections.push({ y0: 0, y1: yPrice, isBase: true });
      }
      return sections;
    }

    function appendCylinderBoundsPoints(points, node, model) {
      const barRadius = Math.min(X_UNIT, Y_UNIT) * 0.24;
      const sections = getPillarSectionsForNode(node, model);
      const angles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      sections.forEach((section) => {
        angles.forEach((theta) => {
          const dx = Math.cos(theta) * barRadius;
          const dz = Math.sin(theta) * barRadius;
          points.push({ x: node.x + dx, y: section.y0, z: node.z + dz });
          points.push({ x: node.x + dx, y: section.y1, z: node.z + dz });
        });
      });
    }

    function collectSceneWorldPoints(model) {
      const points = [];
      const x0 = model.xMin - PLANE_PAD;
      const x1 = model.xMax + PLANE_PAD;
      const z0 = model.zMin;
      const z1 = model.zMax + PLANE_PAD;

      const timeAxisAttachX = getNearestStrikeAxisEndX(model);
      points.push(
        { x: x0, y: 0, z: z0 },
        { x: x1, y: 0, z: z0 },
        { x: x1, y: 0, z: z1 },
        { x: x0, y: 0, z: z1 },
        { x: x0, y: 0, z: 0 },
        { x: x1 + 18, y: 0, z: 0 },
        { x: timeAxisAttachX, y: 0, z: -18 },
        { x: timeAxisAttachX, y: 0, z: z1 + 18 }
      );

      model.nodes.forEach((node) => {
        points.push(
          { x: node.x, y: priceToY(node.intrinsic, model.zScale), z: node.z },
          { x: node.x, y: priceToY(node.price, model.zScale), z: node.z }
        );
      });

      const activeHover = getActiveHover();
      if (activeHover.locked && activeHover.mode === 'bar') {
        const lockedNode = model.nodes.find((node) => node.K === activeHover.strike && node.days === activeHover.days);
        if (lockedNode) appendCylinderBoundsPoints(points, lockedNode, model);
      } else if (activeHover.locked && activeHover.mode === 'strike') {
        model.nodes
          .filter((node) => node.K === activeHover.strike)
          .forEach((node) => appendCylinderBoundsPoints(points, node, model));
      }

      return points;
    }

    function getProjectedSceneBounds(model, rect) {
      const points = collectSceneWorldPoints(model);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      points.forEach((point) => {
        const projected = projectPoint(point, rect);
        if (projected.x < minX) minX = projected.x;
        if (projected.x > maxX) maxX = projected.x;
        if (projected.y < minY) minY = projected.y;
        if (projected.y > maxY) maxY = projected.y;
      });
      if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
        return { minX: 0, maxX: rect.width, minY: 0, maxY: rect.height };
      }
      return { minX, maxX, minY, maxY };
    }

    function getDynamicPanLimits(model, rect) {
      const bounds = getProjectedSceneBounds(model, rect);
      return {
        minOffsetX: state.offsetX - bounds.maxX,
        maxOffsetX: state.offsetX + (rect.width - bounds.minX),
        minOffsetY: state.offsetY - bounds.maxY,
        maxOffsetY: state.offsetY + (rect.height - bounds.minY),
      };
    }

    function clampOffsetsToScene(model, rect) {
      const limits = getDynamicPanLimits(model, rect);
      state.offsetX = clamp(state.offsetX, limits.minOffsetX, limits.maxOffsetX);
      state.offsetY = clamp(state.offsetY, limits.minOffsetY, limits.maxOffsetY);
      return limits;
    }

    function rebuildLayoutAndDraw() {
      state.layoutModel = buildLayoutModel();
      state.barModel = buildBarModel(state.layoutModel);
      setLayoutScaleFromBarModel(state.layoutModel, state.barModel);
      currentPivot = state.layoutModel.pivot;
      pruneHoverAgainstLayout(state.layoutModel);
      draw();
    }

    function rebuildBarsAndDraw() {
      ensureModelCache();
      state.barModel = buildBarModel(state.layoutModel);
      draw();
    }

    function strikeToX(K) { return ((K - 100) / STRIKE_STEP) * X_UNIT; }
    function daysToZ(days) { return (days / DAY_STEP) * Y_UNIT; }
    function getNearestStrikeAxisEndX(model) {
      const leftPoint = projectPoint({ x: model.planeX0, y: 0, z: 0 }, currentRect || canvas.getBoundingClientRect());
      const rightPoint = projectPoint({ x: model.planeX1, y: 0, z: 0 }, currentRect || canvas.getBoundingClientRect());
      return leftPoint.scale >= rightPoint.scale ? model.planeX0 : model.planeX1;
    }
    function priceToY(price, zScale) { return price * zScale; }

    function worldQuad(points) {
      return points.map((p) => projectPoint(p, currentRect));
    }

    let currentRect = null;
    let currentPivot = { x: 0, y: 0, z: 0 };

    function drawPolygon(points2d, fillStyle, strokeStyle = null, lineWidth = 1.0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points2d[0].x, points2d[0].y);
      for (let i = 1; i < points2d.length; i += 1) ctx.lineTo(points2d[i].x, points2d[i].y);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      ctx.restore();
    }

    function faceShade(base, facePoints, role, alphaScale = 1, focus = 1, selected = false) {
      const rp = facePoints.map(rotatePoint);
      const depth = rp.reduce((sum, p) => sum + p.z, 0) / rp.length;
      const focusFactor = 0.18 + 0.82 * focus;
      let intensity = 0.18;
      let alpha = base.a * alphaScale * focusFactor * 0.22;
      let lift = 12;
      let glowBoost = selected ? 18 : 0;
      let strokeBoost = selected ? 58 : 16;
      let strokeAlpha = role === 'top' ? 0.30 : role === 'front-bright' ? 0.18 : 0.05;

      if (role === 'top') {
        intensity = selected ? 1.08 : 0.96;
        alpha = base.a * alphaScale * focusFactor * (selected ? 1.12 : 1.0);
        lift = selected ? 78 : 22;
        glowBoost = selected ? 60 : glowBoost;
        strokeBoost = selected ? 74 : strokeBoost;
        strokeAlpha = selected ? 0.70 : strokeAlpha;
      } else if (role === 'front-bright') {
        intensity = selected ? 0.99 : 0.88;
        alpha = base.a * alphaScale * focusFactor * (selected ? 1.04 : 0.94);
        lift = selected ? 60 : 18;
        glowBoost = selected ? 46 : glowBoost;
        strokeBoost = selected ? 66 : strokeBoost;
        strokeAlpha = selected ? 0.70 : strokeAlpha;
      } else if (role === 'side-dark') {
        intensity = selected ? 0.34 : 0.26;
        alpha = base.a * alphaScale * focusFactor * (selected ? 0.34 : 0.28);
        lift = selected ? 18 : 12;
        glowBoost = selected ? 12 : glowBoost;
        strokeBoost = selected ? 28 : strokeBoost;
        strokeAlpha = selected ? 0.12 : strokeAlpha;
      }

      const t = clamp01(intensity) * (selected ? 1 : (0.80 + 0.20 * focus));
      const r = Math.round(base.r * t + lift * (1 - t));
      const g = Math.round(base.g * t + lift * (1 - t));
      const b = Math.round(base.b * t + (lift + 8) * (1 - t));

      return {
        fill: `rgba(${Math.min(255, r + glowBoost)}, ${Math.min(255, g + glowBoost)}, ${Math.min(255, b + glowBoost)}, ${Math.min(1, alpha)})`,
        stroke: selected
          ? `rgba(${Math.min(255, r + strokeBoost)}, ${Math.min(255, g + strokeBoost)}, ${Math.min(255, b + strokeBoost)}, ${strokeAlpha})`
          : `rgba(${Math.min(255, r + 16)}, ${Math.min(255, g + 16)}, ${Math.min(255, b + 16)}, ${strokeAlpha + 0.10 * focus})`,
        visible: role === 'top' || role === 'front-bright',
        depth,
      };
    }

    function makePrismFaces(centerX, centerZ, widthX, widthZ, y0, y1) {
      const x0 = centerX - widthX / 2;
      const x1 = centerX + widthX / 2;
      const z0 = centerZ - widthZ / 2;
      const z1 = centerZ + widthZ / 2;
      const p000 = { x: x0, y: y0, z: z0 };
      const p100 = { x: x1, y: y0, z: z0 };
      const p110 = { x: x1, y: y0, z: z1 };
      const p010 = { x: x0, y: y0, z: z1 };
      const p001 = { x: x0, y: y1, z: z0 };
      const p101 = { x: x1, y: y1, z: z0 };
      const p111 = { x: x1, y: y1, z: z1 };
      const p011 = { x: x0, y: y1, z: z1 };
      return [
        [p001, p101, p111, p011],
        [p000, p001, p011, p010],
        [p100, p110, p111, p101],
        [p010, p011, p111, p110],
        [p000, p100, p101, p001],
      ];
    }

    function makeCylinderFaces(centerX, centerZ, radiusX, radiusZ, y0, y1, segments = 20) {
      const top = [];
      const bottom = [];
      for (let i = 0; i < segments; i += 1) {
        const theta = (i / segments) * Math.PI * 2;
        const x = centerX + Math.cos(theta) * radiusX;
        const z = centerZ + Math.sin(theta) * radiusZ;
        top.push({ x, y: y1, z });
        bottom.push({ x, y: y0, z });
      }
      const sides = [];
      for (let i = 0; i < segments; i += 1) {
        const ni = (i + 1) % segments;
        sides.push([bottom[i], bottom[ni], top[ni], top[i]]);
      }
      return { top, sides };
    }

function drawBars(model, rect) {
  const surfaceSubdiv = 8;
  const isPutSurface = state.pricingParams.optionType === 'put';
  const intrinsicBase = isPutSurface
    ? { r: 232, g: 208, b: 112, a: 0.60 }
    : { r: 126, g: 214, b: 206, a: 0.60 };
  const priceBase = isPutSurface
    ? { r: 196, g: 122, b: 189, a: 0.56 }
    : { r: 180, g: 151, b: 255, a: 0.56 };
  const intrinsicLineSelected = isPutSurface ? 'rgba(244, 225, 142, 0.76)' : 'rgba(174, 232, 221, 0.72)';
  const intrinsicLineStrong = isPutSurface ? 'rgba(236, 214, 124, 0.60)' : 'rgba(145, 219, 207, 0.58)';
  const intrinsicLineSoft = isPutSurface ? 'rgba(218, 190, 102, 0.36)' : 'rgba(126, 205, 192, 0.34)';
  const priceLineSelected = isPutSurface ? 'rgba(247, 188, 223, 0.76)' : 'rgba(212, 194, 255, 0.72)';
  const priceLineStrong = isPutSurface ? 'rgba(232, 156, 205, 0.60)' : 'rgba(190, 168, 248, 0.56)';
  const priceLineSoft = isPutSurface ? 'rgba(211, 136, 185, 0.34)' : 'rgba(171, 145, 233, 0.32)';
  const intrinsicGuideStroke = isPutSurface ? 'rgba(236, 214, 124, 0.86)' : 'rgba(126, 205, 192, 0.84)';
  const priceGuideStroke = isPutSurface ? 'rgba(232, 156, 205, 0.84)' : 'rgba(217, 118, 255, 0.82)';
  const intrinsicPointSelected = isPutSurface ? 'rgba(255, 243, 181, 0.98)' : 'rgba(214, 246, 237, 0.98)';
  const intrinsicPointStrong = isPutSurface ? 'rgba(244, 225, 142, 0.92)' : 'rgba(160, 230, 219, 0.92)';
  const intrinsicPointSoft = isPutSurface ? 'rgba(218, 190, 102, 0.74)' : 'rgba(133, 207, 195, 0.72)';
  const pricePointSelected = isPutSurface ? 'rgba(255, 226, 242, 0.98)' : 'rgba(234, 224, 255, 0.98)';
  const pricePointStrong = isPutSurface ? 'rgba(247, 188, 223, 0.92)' : 'rgba(198, 175, 255, 0.92)';
  const pricePointSoft = isPutSurface ? 'rgba(211, 136, 185, 0.74)' : 'rgba(171, 145, 233, 0.72)';
  const intrinsicPolys = [];
  const pricePolys = [];
  const pointLabels = [];
  const interactionBars = [];
  const pointDrawItems = [];
  const lineDrawItems = [];
  const activeHover = getActiveHover();
  const showPriceLabels = !!(state.pricePanelVisible && state.pricePanelChecked && activeHover.locked);

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function bilerp(a00, a10, a01, a11, u, v) {
    const a0 = lerp(a00, a10, u);
    const a1 = lerp(a01, a11, u);
    return lerp(a0, a1, v);
  }

  function rgba(base, alpha, lift = 0) {
    return `rgba(${Math.min(255, base.r + lift)}, ${Math.min(255, base.g + lift)}, ${Math.min(255, base.b + lift)}, ${alpha})`;
  }

  function getFocusForNode(node) {
    const lockedDim = 0.22;
    if (!activeHover.mode) return { focus: 1, selected: false };
    if (activeHover.mode === 'bar') {
      const selected = node.K === activeHover.strike && node.days === activeHover.days;
      return { focus: activeHover.locked ? (selected ? 1 : lockedDim) : 1, selected };
    }
    if (activeHover.mode === 'strike') {
      const selected = node.K === activeHover.strike;
      return { focus: activeHover.locked ? (selected ? 1 : lockedDim) : 1, selected };
    }
    if (activeHover.mode === 'day') {
      const selected = node.days === activeHover.days;
      return { focus: activeHover.locked ? (selected ? 1 : lockedDim) : 1, selected };
    }
    return { focus: 1, selected: false };
  }

  function getSurfaceFocus(strikeA, strikeB, dayA, dayB) {
    const lockedDim = 0.22;
    if (!activeHover.mode || !activeHover.locked) return 1;
    const strikeMin = Math.min(strikeA, strikeB);
    const strikeMax = Math.max(strikeA, strikeB);
    const dayMin = Math.min(dayA, dayB);
    const dayMax = Math.max(dayA, dayB);
    if (activeHover.mode === 'strike') {
      return activeHover.strike >= strikeMin && activeHover.strike <= strikeMax ? 1 : lockedDim;
    }
    if (activeHover.mode === 'day') {
      return activeHover.days >= dayMin && activeHover.days <= dayMax ? 1 : lockedDim;
    }
    if (activeHover.mode === 'bar') {
      const strikeMatch = activeHover.strike >= strikeMin && activeHover.strike <= strikeMax;
      const dayMatch = activeHover.days >= dayMin && activeHover.days <= dayMax;
      return strikeMatch && dayMatch ? 1 : lockedDim;
    }
    return 1;
  }

  function pushSurfaceQuad(bucket, points3d, base, alpha, focus, selected = false) {
    const rotated = points3d.map(rotatePoint);
    const depth = rotated.reduce((sum, pt) => sum + pt.z, 0) / rotated.length;
    const focusFactor = 0.34 + 0.66 * focus;
    const fillAlpha = clamp01(alpha * focusFactor * (selected ? 1.04 : 1));
    bucket.push({
      points: points3d,
      depth,
      fill: rgba(base, fillAlpha, selected ? 6 : 0),
      stroke: null,
      lineWidth: 0,
    });
  }

  function drawSinglePillar(node) {
    const barRadius = Math.min(X_UNIT, Y_UNIT) * 0.24;
    const yIntrinsic = priceToY(node.intrinsic, model.zScale);
    const yPrice = priceToY(node.price, model.zScale);
    const sections = [];

    if (yIntrinsic > 0.0001) {
      sections.push({ y0: 0, y1: yIntrinsic, base: intrinsicBase, alphaScale: 0.92, isBase: true });
    }
    if (yPrice > yIntrinsic + 0.0001) {
      sections.push({ y0: yIntrinsic, y1: yPrice, base: priceBase, alphaScale: 0.90, isBase: sections.length === 0 });
    }
    if (!sections.length && yPrice > 0.0001) {
      sections.push({ y0: 0, y1: yPrice, base: priceBase, alphaScale: 0.90, isBase: true });
    }

    function drawCylinderSection(section) {
      const SEGMENTS = 24;
      const sideFaces = [];
      const topRing = [];
      const bottomRing = [];
      const alphaBody = clamp01(section.base.a * section.alphaScale * 0.48);
      const alphaCap = clamp01(section.base.a * section.alphaScale * 0.62);
      const edgeAlpha = clamp01(section.base.a * section.alphaScale * 0.54);

      for (let i = 0; i < SEGMENTS; i += 1) {
        const a0 = (i / SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);

        const b0 = { x: node.x + barRadius * c0, y: section.y0, z: node.z + barRadius * s0 };
        const b1 = { x: node.x + barRadius * c1, y: section.y0, z: node.z + barRadius * s1 };
        const t0 = { x: node.x + barRadius * c0, y: section.y1, z: node.z + barRadius * s0 };
        const t1 = { x: node.x + barRadius * c1, y: section.y1, z: node.z + barRadius * s1 };

        const rb0 = rotatePoint(b0);
        const rb1 = rotatePoint(b1);
        const rt0 = rotatePoint(t0);
        const rt1 = rotatePoint(t1);
        const normalHint = ((rb0.x + rb1.x + rt0.x + rt1.x) * 0.25) / 42;
        const light = clamp01(0.34 + normalHint * 0.36);
        const r = Math.round(section.base.r * (0.72 + light * 0.42));
        const g = Math.round(section.base.g * (0.74 + light * 0.40));
        const b = Math.round(section.base.b * (0.76 + light * 0.36));
        const faceFill = `rgba(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)}, ${alphaBody})`;
        const faceStroke = `rgba(${Math.min(255, r + 26)}, ${Math.min(255, g + 26)}, ${Math.min(255, b + 26)}, ${edgeAlpha * 0.56})`;

        sideFaces.push({
          depth: (rb0.z + rb1.z + rt0.z + rt1.z) * 0.25,
          points3d: [b0, b1, t1, t0],
          fill: faceFill,
          stroke: faceStroke,
        });
        topRing.push(t0);
        bottomRing.push(b0);
      }

      sideFaces.sort((a, b) => a.depth - b.depth).forEach((face) => {
        const poly = face.points3d.map((pt) => projectPoint(pt, rect));
        drawPolygon(poly, face.fill, face.stroke, 0.55);
      });

      const topFill = `rgba(${Math.min(255, section.base.r + 42)}, ${Math.min(255, section.base.g + 42)}, ${Math.min(255, section.base.b + 42)}, ${alphaCap})`;
      const topStroke = `rgba(${Math.min(255, section.base.r + 70)}, ${Math.min(255, section.base.g + 70)}, ${Math.min(255, section.base.b + 70)}, ${edgeAlpha})`;
      const bottomFill = `rgba(${section.base.r}, ${section.base.g}, ${section.base.b}, ${alphaBody * 0.34})`;
      const bottomStroke = `rgba(255,255,255,0.05)`;

      drawPolygon(topRing.map((pt) => projectPoint(pt, rect)), topFill, topStroke, 0.8);
      if (section.isBase) {
        drawPolygon(bottomRing.map((pt) => projectPoint(pt, rect)), bottomFill, bottomStroke, 0.4);
      }

      const centerBottom = projectPoint({ x: node.x, y: section.y0, z: node.z }, rect);
      const centerTop = projectPoint({ x: node.x, y: section.y1, z: node.z }, rect);
      ctx.save();
      ctx.strokeStyle = `rgba(247, 252, 255, ${section.base === intrinsicBase ? 0.22 : 0.18})`;
      ctx.lineWidth = Math.max(0.8, barRadius * 0.18);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(centerBottom.x, centerBottom.y);
      ctx.lineTo(centerTop.x, centerTop.y);
      ctx.stroke();
      ctx.restore();
    }

    sections.forEach((section) => {
      drawCylinderSection(section);
    });
  }

  const grid = model.grid || [];
  for (let i = 0; i < grid.length - 1; i += 1) {
    for (let j = 0; j < grid[i].length - 1; j += 1) {
      const n00 = grid[i][j];
      const n10 = grid[i + 1][j];
      const n01 = grid[i][j + 1];
      const n11 = grid[i + 1][j + 1];
      const focus = getSurfaceFocus(n00.K, n10.K, n00.days, n01.days);
      const selectedSurface = false;
      const x00 = n00.x;
      const x10 = n10.x;
      const z00 = n00.z;
      const z01 = n01.z;
      const hi00 = priceToY(n00.intrinsic, model.zScale);
      const hi10 = priceToY(n10.intrinsic, model.zScale);
      const hi01 = priceToY(n01.intrinsic, model.zScale);
      const hi11 = priceToY(n11.intrinsic, model.zScale);
      const hp00 = priceToY(n00.price, model.zScale);
      const hp10 = priceToY(n10.price, model.zScale);
      const hp01 = priceToY(n01.price, model.zScale);
      const hp11 = priceToY(n11.price, model.zScale);

      for (let su = 0; su < surfaceSubdiv; su += 1) {
        const u0 = su / surfaceSubdiv;
        const u1 = (su + 1) / surfaceSubdiv;
        for (let sv = 0; sv < surfaceSubdiv; sv += 1) {
          const v0 = sv / surfaceSubdiv;
          const v1 = (sv + 1) / surfaceSubdiv;
          const intrinsicQuad = [
            { x: lerp(x00, x10, u0), y: bilerp(hi00, hi10, hi01, hi11, u0, v0), z: lerp(z00, z01, v0) },
            { x: lerp(x00, x10, u1), y: bilerp(hi00, hi10, hi01, hi11, u1, v0), z: lerp(z00, z01, v0) },
            { x: lerp(x00, x10, u1), y: bilerp(hi00, hi10, hi01, hi11, u1, v1), z: lerp(z00, z01, v1) },
            { x: lerp(x00, x10, u0), y: bilerp(hi00, hi10, hi01, hi11, u0, v1), z: lerp(z00, z01, v1) },
          ];
          const priceQuad = [
            { x: lerp(x00, x10, u0), y: bilerp(hp00, hp10, hp01, hp11, u0, v0), z: lerp(z00, z01, v0) },
            { x: lerp(x00, x10, u1), y: bilerp(hp00, hp10, hp01, hp11, u1, v0), z: lerp(z00, z01, v0) },
            { x: lerp(x00, x10, u1), y: bilerp(hp00, hp10, hp01, hp11, u1, v1), z: lerp(z00, z01, v1) },
            { x: lerp(x00, x10, u0), y: bilerp(hp00, hp10, hp01, hp11, u0, v1), z: lerp(z00, z01, v1) },
          ];
          pushSurfaceQuad(intrinsicPolys, intrinsicQuad, intrinsicBase, 0.18, focus, selectedSurface);
          pushSurfaceQuad(pricePolys, priceQuad, priceBase, 0.15, focus, selectedSurface);
        }
      }
    }
  }

  intrinsicPolys.sort((a, b) => a.depth - b.depth).forEach((item) => {
    const poly = item.points.map((pt) => projectPoint(pt, rect));
    drawPolygon(poly, item.fill, item.stroke, item.lineWidth);
  });
  pricePolys.sort((a, b) => a.depth - b.depth).forEach((item) => {
    const poly = item.points.map((pt) => projectPoint(pt, rect));
    drawPolygon(poly, item.fill, item.stroke, item.lineWidth);
  });


  for (let i = 0; i < grid.length; i += 1) {
    for (let j = 0; j < grid[i].length; j += 1) {
      const node = grid[i][j];
      const thisFocusInfo = getFocusForNode(node);
      const intrinsicPointA = { x: node.x, y: priceToY(node.intrinsic, model.zScale), z: node.z };
      const pricePointA = { x: node.x, y: priceToY(node.price, model.zScale), z: node.z };

      if (i < grid.length - 1) {
        const nodeB = grid[i + 1][j];
        const nextFocusInfo = getFocusForNode(nodeB);
        const focusMix = Math.min(thisFocusInfo.focus, nextFocusInfo.focus);
        const selectedPair = thisFocusInfo.selected && nextFocusInfo.selected;
        const intrinsicPointB = { x: nodeB.x, y: priceToY(nodeB.intrinsic, model.zScale), z: nodeB.z };
        const pricePointB = { x: nodeB.x, y: priceToY(nodeB.price, model.zScale), z: nodeB.z };
        const intrinsicDepth = (rotatePoint(intrinsicPointA).z + rotatePoint(intrinsicPointB).z) * 0.5;
        const priceDepth = (rotatePoint(pricePointA).z + rotatePoint(pricePointB).z) * 0.5;
        lineDrawItems.push({
          a: projectPoint(intrinsicPointA, rect),
          b: projectPoint(intrinsicPointB, rect),
          depth: intrinsicDepth,
          stroke: selectedPair ? intrinsicLineSelected : (focusMix > 0.9 ? intrinsicLineStrong : intrinsicLineSoft),
          width: selectedPair ? 0.85 : 0.6,
        });
        lineDrawItems.push({
          a: projectPoint(pricePointA, rect),
          b: projectPoint(pricePointB, rect),
          depth: priceDepth,
          stroke: selectedPair ? priceLineSelected : (focusMix > 0.9 ? priceLineStrong : priceLineSoft),
          width: selectedPair ? 0.85 : 0.6,
        });
      }

      if (j < grid[i].length - 1) {
        const nodeB = grid[i][j + 1];
        const nextFocusInfo = getFocusForNode(nodeB);
        const focusMix = Math.min(thisFocusInfo.focus, nextFocusInfo.focus);
        const selectedPair = thisFocusInfo.selected && nextFocusInfo.selected;
        const intrinsicPointB = { x: nodeB.x, y: priceToY(nodeB.intrinsic, model.zScale), z: nodeB.z };
        const pricePointB = { x: nodeB.x, y: priceToY(nodeB.price, model.zScale), z: nodeB.z };
        const intrinsicDepth = (rotatePoint(intrinsicPointA).z + rotatePoint(intrinsicPointB).z) * 0.5;
        const priceDepth = (rotatePoint(pricePointA).z + rotatePoint(pricePointB).z) * 0.5;
        lineDrawItems.push({
          a: projectPoint(intrinsicPointA, rect),
          b: projectPoint(intrinsicPointB, rect),
          depth: intrinsicDepth,
          stroke: selectedPair ? intrinsicLineSelected : (focusMix > 0.9 ? intrinsicLineStrong : intrinsicLineSoft),
          width: selectedPair ? 0.85 : 0.6,
        });
        lineDrawItems.push({
          a: projectPoint(pricePointA, rect),
          b: projectPoint(pricePointB, rect),
          depth: priceDepth,
          stroke: selectedPair ? priceLineSelected : (focusMix > 0.9 ? priceLineStrong : priceLineSoft),
          width: selectedPair ? 0.85 : 0.6,
        });
      }
    }
  }

  let lockedNode = null;
  if (activeHover.mode === 'bar') {
    lockedNode = model.nodes.find((node) => node.K === activeHover.strike && node.days === activeHover.days) || null;
    if (lockedNode) {
      const xGuideStart = { x: model.xMin - PLANE_PAD, y: 0, z: lockedNode.z };
      const xGuideEnd = { x: model.xMax + PLANE_PAD, y: 0, z: lockedNode.z };
      const yGuideStart = { x: lockedNode.x, y: 0, z: model.zMin };
      const yGuideEnd = { x: lockedNode.x, y: 0, z: model.zMax + PLANE_PAD };
      drawSegment3D(xGuideStart, xGuideEnd, priceGuideStroke, 1.45, rect, [6, 5]);
      drawSegment3D(yGuideStart, yGuideEnd, intrinsicGuideStroke, 1.45, rect, [6, 5]);
      const baseAnchor = projectPoint({ x: lockedNode.x, y: 0, z: lockedNode.z }, rect);
      ctx.save();
      ctx.fillStyle = 'rgba(246, 250, 255, 0.96)';
      ctx.beginPath();
      ctx.arc(baseAnchor.x, baseAnchor.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (activeHover.locked) {
        drawSinglePillar(lockedNode);
      }
    }
  } else if (activeHover.locked && activeHover.mode === 'strike') {
    const strikeX = strikeToX(activeHover.strike);
    drawSegment3D(
      { x: strikeX, y: 0, z: model.zMin },
      { x: strikeX, y: 0, z: model.zMax + PLANE_PAD },
      intrinsicGuideStroke,
      1.45,
      rect,
      [6, 5]
    );
    model.nodes
      .filter((node) => node.K === activeHover.strike)
      .sort((a, b) => rotatePoint({ x: a.x, y: priceToY(a.price, model.zScale), z: a.z }).z - rotatePoint({ x: b.x, y: priceToY(b.price, model.zScale), z: b.z }).z)
      .forEach((node) => {
        drawSinglePillar(node);
      });
  } else if (activeHover.locked && activeHover.mode === 'day') {
    const dayZ = daysToZ(activeHover.days);
    drawSegment3D(
      { x: model.xMin - PLANE_PAD, y: 0, z: dayZ },
      { x: model.xMax + PLANE_PAD, y: 0, z: dayZ },
      priceGuideStroke,
      1.45,
      rect,
      [6, 5]
    );
    model.nodes
      .filter((node) => node.days === activeHover.days)
      .sort((a, b) => rotatePoint({ x: a.x, y: priceToY(a.price, model.zScale), z: a.z }).z - rotatePoint({ x: b.x, y: priceToY(b.price, model.zScale), z: b.z }).z)
      .forEach((node) => {
        drawSinglePillar(node);
      });
  }

  model.nodes.forEach((node) => {
    const { focus, selected } = getFocusForNode(node);
    const intrinsicPoint = { x: node.x, y: priceToY(node.intrinsic, model.zScale), z: node.z };
    const pricePoint = { x: node.x, y: priceToY(node.price, model.zScale), z: node.z };
    const intrinsicProjected = projectPoint(intrinsicPoint, rect);
    const priceProjected = projectPoint(pricePoint, rect);
    const intrinsicRotated = rotatePoint(intrinsicPoint);
    const priceRotated = rotatePoint(pricePoint);
    const intrinsicRadius = selected ? 2.2 : (focus > 0.9 ? 1.8 : 1.45);
    const priceRadius = selected ? 2.45 : (focus > 0.9 ? 2.0 : 1.6);

    pointDrawItems.push({
      projected: intrinsicProjected,
      depth: intrinsicRotated.z,
      radius: intrinsicRadius,
      fill: selected ? intrinsicPointSelected : (focus > 0.9 ? intrinsicPointStrong : intrinsicPointSoft),
    });
    pointDrawItems.push({
      projected: priceProjected,
      depth: priceRotated.z,
      radius: priceRadius,
      fill: selected ? pricePointSelected : (focus > 0.9 ? pricePointStrong : pricePointSoft),
    });

    interactionBars.push({
      K: node.K,
      days: node.days,
      depth: priceRotated.z,
      bbox: {
        minX: priceProjected.x - 10,
        maxX: priceProjected.x + 10,
        minY: priceProjected.y - 10,
        maxY: priceProjected.y + 10,
      },
      center2d: priceProjected,
    });

    if (showPriceLabels && selected) {
      const intrinsicValue = Number(node.intrinsic) || 0;
      const timeValue = Number(node.timeValue) || 0;
      const hasIntrinsic = intrinsicValue > 0.0001;
      const hasTime = timeValue > 0.0001;

      if (hasTime) {
        pointLabels.push({
          center: pricePoint,
          value: timeValue,
          color: 'rgba(246, 239, 255, 1)',
          dy: hasIntrinsic ? -18 : -14,
        });
      }
      if (hasIntrinsic) {
        pointLabels.push({
          center: hasTime ? intrinsicPoint : pricePoint,
          value: intrinsicValue,
          color: 'rgba(214, 246, 237, 0.98)',
          dy: hasTime ? -6 : -12,
        });
      }
    }
  });

  state.interactions.bars = interactionBars;

  if (state.pricingParams.showGrid !== false) {
    lineDrawItems.sort((a, b) => a.depth - b.depth).forEach((item) => {
      ctx.save();
      ctx.strokeStyle = item.stroke;
      ctx.lineWidth = item.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(item.a.x, item.a.y);
      ctx.lineTo(item.b.x, item.b.y);
      ctx.stroke();
      ctx.restore();
    });
  }

  if (state.pricingParams.showGrid !== false) {
    pointDrawItems.sort((a, b) => a.depth - b.depth).forEach((item) => {
      ctx.save();
      ctx.fillStyle = item.fill;
      ctx.beginPath();
      ctx.arc(item.projected.x, item.projected.y, item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  if (showPriceLabels) {
    pointLabels
      .sort((a, b) => rotatePoint(a.center).z - rotatePoint(b.center).z)
      .forEach((label) => {
        drawTextAt(label.center, label.value.toFixed(1), rect, { color: label.color, font: '600 10px Inter, system-ui, sans-serif', dy: label.dy, shadow: 'rgba(0,0,0,0.18)' });
      });
  }
}

function drawPlaneAndAxes(model, rect) {
      const showGrid = state.pricingParams.showGrid !== false;
      const activeHover = getActiveHover();
      const highlightedStrike = (activeHover.mode === 'strike' || activeHover.mode === 'bar') ? activeHover.strike : null;
      const highlightedDay = (activeHover.mode === 'day' || activeHover.mode === 'bar') ? activeHover.days : null;
      const x0 = model.xMin - PLANE_PAD;
      const x1 = model.xMax + PLANE_PAD;
      const z0 = model.zMin;
      const z1 = model.zMax + PLANE_PAD;
      // plane glow
      const planeQuad = [
        { x: x0, y: 0, z: z0 },
        { x: x1, y: 0, z: z0 },
        { x: x1, y: 0, z: z1 },
        { x: x0, y: 0, z: z1 },
      ].map((p) => projectPoint(p, rect));
      drawPolygon(planeQuad, 'rgba(18, 34, 64, 0.30)', 'rgba(116, 176, 245, 0.10)', 1);

      const frontStrikePoints = [];
      const frontStrikeLabels = [];
      model.strikeTicks.forEach((K) => {
        const x = strikeToX(K);
        const isHighlighted = highlightedStrike === K;
        const labelText = String(K);
        const labelFont = isHighlighted ? '700 11px Inter, system-ui, sans-serif' : '600 10px Inter, system-ui, sans-serif';
        const labelColor = isHighlighted ? 'rgba(206, 248, 255, 0.98)' : 'rgba(206, 217, 241, 0.70)';
        if (showGrid) {
          drawSegment3D(
            { x, y: 0, z: z0 },
            { x, y: 0, z: z1 },
            isHighlighted ? 'rgba(132, 225, 255, 0.24)' : 'rgba(126, 164, 214, 0.14)',
            isHighlighted ? 1.6 : 1,
            rect,
            isHighlighted ? [] : [3, 7]
          );
        }
        const tickProj = drawSegment3D(
          { x, y: 0, z: 0 },
          { x, y: -6, z: 0 },
          isHighlighted ? 'rgba(206, 248, 255, 0.52)' : 'rgba(188, 212, 246, 0.32)',
          isHighlighted ? 1.4 : 1.2,
          rect
        );
        frontStrikePoints.push({ K, x: tickProj.pa.x, y: tickProj.pa.y });
        const labelPoint = { x, y: -16, z: 0 };
        const labelProjected = projectPoint(labelPoint, rect);
        ctx.save();
        ctx.font = labelFont;
        const labelMetrics = ctx.measureText(labelText);
        ctx.restore();
        frontStrikeLabels.push({
          K,
          center: { x: labelProjected.x, y: labelProjected.y },
          bbox: {
            minX: labelProjected.x - labelMetrics.width * 0.5 - 5,
            maxX: labelProjected.x + labelMetrics.width * 0.5 + 5,
            minY: labelProjected.y - (isHighlighted ? 10 : 9),
            maxY: labelProjected.y + (isHighlighted ? 10 : 9),
          },
        });
        drawTextAt(labelPoint, labelText, rect, {
          color: labelColor,
          font: labelFont,
          shadow: isHighlighted ? 'rgba(112,213,255,0.28)' : null,
        });
      });
      state.interactions.frontStrikePoints = frontStrikePoints;
      state.interactions.frontStrikeLabels = frontStrikeLabels;

      // axes
      const axisYMax = Math.max(120, priceToY(Math.max(model.maxPrice, 1), model.zScale) + 20);
      const frontAxis = drawSegment3D({ x: x0, y: 0, z: 0 }, { x: x1 + 18, y: 0, z: 0 }, 'rgba(112, 213, 255, 0.96)', 2.6, rect);
      state.interactions.frontAxis = { a: frontAxis.pa, b: frontAxis.pb };
      const timeAxisAttachX = getNearestStrikeAxisEndX(model);
      const timeAxis = drawSegment3D({ x: timeAxisAttachX, y: 0, z: -18 }, { x: timeAxisAttachX, y: 0, z: z1 + 18 }, 'rgba(217, 118, 255, 0.96)', 2.6, rect);

      const planeCenterProjected = projectPoint({ x: (x0 + x1) * 0.5, y: 0, z: (z0 + z1) * 0.5 }, rect);
      const timeAxisVecX = timeAxis.pb.x - timeAxis.pa.x;
      const timeAxisVecY = timeAxis.pb.y - timeAxis.pa.y;
      const timeAxisLen = Math.hypot(timeAxisVecX, timeAxisVecY) || 1;
      let timeAxisNormalX = -timeAxisVecY / timeAxisLen;
      let timeAxisNormalY = timeAxisVecX / timeAxisLen;
      const timeAxisMidX = (timeAxis.pa.x + timeAxis.pb.x) * 0.5;
      const timeAxisMidY = (timeAxis.pa.y + timeAxis.pb.y) * 0.5;
      const towardPlaneX = planeCenterProjected.x - timeAxisMidX;
      const towardPlaneY = planeCenterProjected.y - timeAxisMidY;
      if ((timeAxisNormalX * towardPlaneX + timeAxisNormalY * towardPlaneY) > 0) {
        timeAxisNormalX *= -1;
        timeAxisNormalY *= -1;
      }

      const timeDayLabels = [];
      model.dayTicks.forEach((days) => {
        const z = daysToZ(days);
        const isHighlighted = highlightedDay === days;
        if (showGrid) {
          drawSegment3D(
            { x: x0, y: 0, z },
            { x: x1, y: 0, z },
            isHighlighted ? 'rgba(226, 152, 255, 0.26)' : 'rgba(126, 164, 214, 0.14)',
            isHighlighted ? 1.6 : 1,
            rect,
            isHighlighted ? [] : [3, 7]
          );
        }
        const tickProj = projectPoint({ x: timeAxisAttachX, y: 0, z }, rect);
        const labelText = `${days}天`;
        const tickLen = isHighlighted ? 10 : 8;
        const labelGap = isHighlighted ? 9 : 8;
        const labelFont = isHighlighted ? '700 11px Inter, system-ui, sans-serif' : '600 10px Inter, system-ui, sans-serif';
        const labelX = tickProj.x;
        const labelY = tickProj.y + tickLen + labelGap;

        ctx.save();
        ctx.strokeStyle = isHighlighted ? 'rgba(239, 188, 255, 0.60)' : 'rgba(217, 118, 255, 0.34)';
        ctx.lineWidth = isHighlighted ? 1.4 : 1.1;
        if (isHighlighted) {
          ctx.shadowColor = 'rgba(217,118,255,0.22)';
          ctx.shadowBlur = 6;
        }
        ctx.beginPath();
        ctx.moveTo(tickProj.x, tickProj.y);
        ctx.lineTo(tickProj.x, tickProj.y + tickLen);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.font = labelFont;
        const labelMetrics = ctx.measureText(labelText);
        ctx.restore();
        timeDayLabels.push({
          days,
          center: { x: labelX, y: labelY },
          bbox: {
            minX: labelX - labelMetrics.width * 0.5 - 5,
            maxX: labelX + labelMetrics.width * 0.5 + 5,
            minY: labelY - (isHighlighted ? 10 : 9),
            maxY: labelY + (isHighlighted ? 10 : 9),
          },
        });

        ctx.save();
        ctx.font = labelFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isHighlighted ? 'rgba(248, 230, 255, 0.98)' : 'rgba(217, 196, 245, 0.82)';
        if (isHighlighted) {
          ctx.shadowColor = 'rgba(217,118,255,0.24)';
          ctx.shadowBlur = 8;
        }
        ctx.fillText(labelText, labelX, labelY);
        ctx.restore();
      });
      state.interactions.timeDayLabels = timeDayLabels;

      drawTextAt({ x: x0 - 26, y: 0, z: 0 }, '行权价 X', rect, { align: 'right', dx: -6, color: 'rgba(112, 213, 255, 0.98)', font: '700 12px Inter, system-ui, sans-serif', shadow: 'rgba(112,213,255,0.24)' });
      const timeTitleProj = projectPoint({ x: timeAxisAttachX, y: 0, z: z1 + 32 }, rect);
      ctx.save();
      ctx.font = '700 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(217, 118, 255, 0.98)';
      ctx.shadowColor = 'rgba(217,118,255,0.24)';
      ctx.shadowBlur = 8;
      ctx.fillText('时间 Y', timeTitleProj.x + timeAxisNormalX * 24, timeTitleProj.y + timeAxisNormalY * 24);
      ctx.restore();

      const originP = projectPoint({ x: 0, y: 0, z: 0 }, rect);
      ctx.save();
      const glow = ctx.createRadialGradient(originP.x, originP.y, 0, originP.x, originP.y, 10);
      glow.addColorStop(0, 'rgba(255,255,255,0.40)');
      glow.addColorStop(0.45, 'rgba(157, 212, 255, 0.18)');
      glow.addColorStop(1, 'rgba(157, 212, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(originP.x, originP.y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(232, 241, 255, 0.58)';
      ctx.beginPath(); ctx.arc(originP.x, originP.y, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function updateReadout(model) {
      if (!viewReadout) return;
      const xCount = model.strikeTicks.length;
      const yCount = model.dayTicks.length;
      const activeType = state.pricingParams.optionType === 'put' ? 'Put' : 'Call';
      const activeHover = getActiveHover();
      const hoverText = activeHover.mode === 'bar'
        ? ` ｜ ${activeHover.locked ? '锁定' : '悬浮'}：K=${activeHover.strike}，T=${activeHover.days}天价格点`
        : activeHover.mode === 'strike'
          ? ` ｜ ${activeHover.locked ? '锁定' : '悬浮'}：行权价 ${activeHover.strike}`
          : activeHover.mode === 'day'
            ? ` ｜ ${activeHover.locked ? '锁定' : '悬浮'}：期限 ${activeHover.days}天`
            : '';
      viewReadout.textContent = `视角：X ${Math.round(state.yaw * DEG)}° · Y ${Math.round(state.roll * DEG)}° · Z ${Math.round(state.pitch * DEG)}° ｜ 当前曲面：${activeType} ｜ 网格：${xCount} × ${yCount} ｜ 最大 ${activeType} 价格：${model.maxPrice.toFixed(2)}${hoverText}`;
    }

    function draw() {
      const rect = canvas.getBoundingClientRect();
      currentRect = rect;
      const model = buildModel();
      clampOffsetsToScene(model, rect);
      state.interactions.bars = [];
      state.interactions.frontStrikePoints = [];
      state.interactions.frontStrikeLabels = [];
      state.interactions.timeDayLabels = [];
      state.interactions.frontAxis = null;
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawGridBackdrop(rect);
      if (state.layoutModel && state.layoutModel.pivot) currentPivot = state.layoutModel.pivot;
      drawPlaneAndAxes(model, rect);
      drawBars(model, rect);
      updateReadout(model);
      updatePriceBoardReadout();
      syncLocatorSelectionFromActiveHover();
      syncPricePanelUI();
    }

    function startDrag(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      state.dragMode = event.ctrlKey ? 'rotate' : 'pan';
      state.pointerStartX = event.clientX;
      state.pointerStartY = event.clientY;
      state.pointerDragDistance = 0;
      canvas.classList.toggle('is-panning', state.dragMode === 'pan');
      canvas.classList.toggle('is-rotating', state.dragMode === 'rotate');
    }

    function onMove(event) {
      if (isOverlayControlEvent(event)) {
        const dragCancelled = cancelCanvasInteraction();
        const hoverCleared = clearTransientHoverIfNeeded();
        if (dragCancelled || hoverCleared) draw();
        return;
      }
      if (!state.dragMode) {
        if (computeHoverAt(event.clientX, event.clientY)) draw();
        return;
      }
      const dx = event.clientX - state.pointerStartX;
      const dy = event.clientY - state.pointerStartY;
      state.pointerDragDistance = (state.pointerDragDistance || 0) + Math.hypot(dx, dy);
      state.pointerStartX = event.clientX;
      state.pointerStartY = event.clientY;
      if (state.dragMode === 'pan') {
        const rect = currentRect || canvas.getBoundingClientRect();
        const model = buildModel();
        const limits = getDynamicPanLimits(model, rect);
        state.offsetX = clamp(state.offsetX + dx, limits.minOffsetX, limits.maxOffsetX);
        state.offsetY = clamp(state.offsetY + dy, limits.minOffsetY, limits.maxOffsetY);
      } else {
        const rect = currentRect || canvas.getBoundingClientRect();
        const pivotPoint = currentPivot || (state.layoutModel && state.layoutModel.pivot) || { x: 0, y: 0, z: 0 };
        const pivot2d = projectPoint(pivotPoint, rect);
        const localPrevX = state.pointerStartX - rect.left;
        const localPrevY = state.pointerStartY - rect.top;
        const sampleX = localPrevX + dx * 0.5;
        const sampleY = localPrevY + dy * 0.5;

        const yawSign = sampleY < pivot2d.y ? 1 : -1;
        const pitchSign = -1;

        state.yaw += dx * 0.006 * yawSign;
        state.pitch = clamp(state.pitch + dy * 0.005 * pitchSign, -PITCH_LIMIT, PITCH_LIMIT);
      }
      draw();
    }

    function endDrag(event, { allowLock = true } = {}) {
      if (event && isOverlayControlEvent(event)) {
        cancelCanvasInteraction();
        if (clearTransientHoverIfNeeded()) draw();
        return;
      }
      const wasDragMode = state.dragMode;
      const moved = (state.pointerDragDistance || 0) > 4;
      state.dragMode = null;
      state.pointerDragDistance = 0;
      canvas.classList.remove('is-panning', 'is-rotating');
      if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        if (computeHoverAt(event.clientX, event.clientY)) draw();
        if (allowLock && !hasLockedHover() && !moved && event.button === 0 && state.hoverMode) {
          if (setLockedHoverFromCurrent(event)) draw();
        }
      }
    }

    function onWheel(event) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0012);
      state.zoom = clamp(state.zoom * factor, 1.5, 10);
      draw();
    }

    function syncBubbleControlPositions() {
      if (!bubble || !view) return;
      const bubbleTop = bubble.offsetTop || 0;
      const bubbleHeight = bubble.offsetHeight || 0;
      const centerY = bubbleTop + (bubbleHeight / 2);
      const dockInset = 16;
      if (dockBtn) {
        dockBtn.style.top = `${Math.round(centerY)}px`;
        dockBtn.style.left = `${dockInset}px`;
      }
      if (topControls) {
        topControls.style.left = '';
        topControls.style.right = '';
      }
    }

    function syncLocatorControlPositions() {
      if (!locatorBubble || !view) return;
      const bubbleTop = locatorBubble.offsetTop || 0;
      const bubbleHeight = locatorBubble.offsetHeight || 0;
      const centerY = bubbleTop + (bubbleHeight / 2);
      const dockInset = 16;
      if (locatorDockBtn) {
        locatorDockBtn.style.top = `${Math.round(centerY)}px`;
        locatorDockBtn.style.right = `${dockInset}px`;
        locatorDockBtn.style.left = 'auto';
      }
    }

    function syncPriceBoardPositions() {
      if (!priceBoard || !view) return;
      const gap = 18;
      const rightInset = 22;
      let top = rightInset;
      if (state.locatorCollapsed && locatorDockBtn) {
        const dockTop = locatorDockBtn.offsetTop || 0;
        const dockHeight = locatorDockBtn.offsetHeight || 0;
        top = dockTop + Math.round(dockHeight / 2) + gap;
      } else if (locatorBubble) {
        const bubbleTop = locatorBubble.offsetTop || 0;
        const bubbleHeight = locatorBubble.offsetHeight || 0;
        top = bubbleTop + bubbleHeight + gap;
      }
      priceBoard.style.right = `${rightInset}px`;
      priceBoard.style.left = 'auto';
      priceBoard.style.top = `${Math.round(top)}px`;
      if (priceBoardDockBtn) {
        const boardTop = priceBoard.offsetTop || Math.round(top);
        const boardHeight = priceBoard.offsetHeight || 0;
        const centerY = boardTop + (boardHeight / 2);
        priceBoardDockBtn.style.top = `${Math.round(centerY)}px`;
        priceBoardDockBtn.style.right = '16px';
        priceBoardDockBtn.style.left = 'auto';
      }
    }

    function syncTopControlPositions() {
      if (!topControls || !view || !topDockBtn) return;
      const controlLeft = topControls.offsetLeft || 0;
      const controlTop = topControls.offsetTop || 0;
      const controlWidth = topControls.offsetWidth || 0;
      const centerX = controlLeft + (controlWidth / 2);
      const outerGap = 6;
      const dockInset = 16;
      const isCollapsed = view.classList.contains('chain3d-top-collapsed');
      const controlBody = topControls.querySelector('.chain3d-top-controls-body');
      const bodyHeight = controlBody ? controlBody.offsetHeight : 0;
      const dockTop = isCollapsed ? dockInset : (controlTop + bodyHeight + outerGap);
      topDockBtn.style.left = `${Math.round(centerX)}px`;
      topDockBtn.style.top = `${Math.round(dockTop)}px`;
    }

    function setCollapsed(collapsed) {
      state.collapsed = !!collapsed;
      view.classList.toggle('chain3d-bubble-collapsed', state.collapsed);
      if (toggleBtn) {
        toggleBtn.textContent = '‹';
        toggleBtn.setAttribute('aria-label', '收起参数面板');
      }
      if (dockBtn) {
        dockBtn.textContent = '›';
        dockBtn.setAttribute('aria-label', '展开参数面板');
      }
      syncBubbleControlPositions();
    }

    function setLocatorCollapsed(collapsed) {
      state.locatorCollapsed = !!collapsed;
      view.classList.toggle('chain3d-locator-collapsed', state.locatorCollapsed);
      if (locatorToggleBtn) {
        locatorToggleBtn.textContent = '›';
        locatorToggleBtn.setAttribute('aria-label', '收起期权定位器');
      }
      if (locatorDockBtn) {
        locatorDockBtn.textContent = '‹';
        locatorDockBtn.setAttribute('aria-label', '展开期权定位器');
      }
      syncLocatorControlPositions();
      syncPriceBoardPositions();
    }

    function setPriceBoardCollapsed(collapsed) {
      state.priceBoardCollapsed = !!collapsed;
      view.classList.toggle('chain3d-priceboard-collapsed', state.priceBoardCollapsed);
      if (priceBoardToggleBtn) {
        priceBoardToggleBtn.textContent = '›';
        priceBoardToggleBtn.setAttribute('aria-label', '收起期权价格看板');
      }
      if (priceBoardDockBtn) {
        priceBoardDockBtn.textContent = '‹';
        priceBoardDockBtn.setAttribute('aria-label', '展开期权价格看板');
      }
      syncPriceBoardPositions();
    }

    function setTopCollapsed(collapsed) {
      state.topCollapsed = !!collapsed;
      view.classList.toggle('chain3d-top-collapsed', state.topCollapsed);
      if (topToggleBtn) {
        topToggleBtn.textContent = '⌃';
        topToggleBtn.setAttribute('aria-label', '收起顶部面板');
      }
      if (topDockBtn) {
        topDockBtn.textContent = '⌄';
        topDockBtn.setAttribute('aria-label', '展开顶部面板');
      }
      syncTopControlPositions();
      requestAnimationFrame(syncTopControlPositions);
      setTimeout(syncTopControlPositions, 180);
      requestAnimationFrame(syncPriceBoardPositions);
    }

    window.addEventListener('resize', syncBubbleControlPositions);
    window.addEventListener('resize', syncTopControlPositions);
    window.addEventListener('resize', syncLocatorControlPositions);
    window.addEventListener('resize', syncPriceBoardPositions);
    window.addEventListener('resize', syncPricePanelUI);
    requestAnimationFrame(syncBubbleControlPositions);
    requestAnimationFrame(syncTopControlPositions);
    requestAnimationFrame(syncLocatorControlPositions);
    requestAnimationFrame(syncPriceBoardPositions);

    function applyPricingOnly() {
      pullPricingParamsFromInputs();
      rebuildBarsAndDraw();
    }

    function applyAllInputs() {
      pullLayoutParamsFromInputs(false);
      pullPricingParamsFromInputs(false);
      syncInputs();
      rebuildLayoutAndDraw();
    }

    toggleBtn?.addEventListener('click', () => setCollapsed(true));
    dockBtn?.addEventListener('click', () => setCollapsed(false));
    topToggleBtn?.addEventListener('click', () => setTopCollapsed(true));
    topDockBtn?.addEventListener('click', () => setTopCollapsed(false));
    locatorToggleBtn?.addEventListener('click', () => setLocatorCollapsed(true));
    locatorDockBtn?.addEventListener('click', () => setLocatorCollapsed(false));
    priceBoardToggleBtn?.addEventListener('click', () => setPriceBoardCollapsed(true));
    priceBoardDockBtn?.addEventListener('click', () => setPriceBoardCollapsed(false));
    locatorApplyBtn?.addEventListener('click', () => {
      applyLocatorSelection();
    });
    locatorInputs.strike?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyLocatorSelection();
      }
    });
    locatorInputs.month?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyLocatorSelection();
      }
    });
    locatorInputs.strike?.addEventListener('change', () => {
      state.locatorDisplayAuto = false;
    });
    locatorInputs.month?.addEventListener('change', () => {
      state.locatorDisplayAuto = false;
    });
    applyBtn?.addEventListener('click', applyAllInputs);

    [inputs.optionType, inputs.rate, inputs.minStrike, inputs.maxStrike, inputs.maxDays].forEach((input) => {
      if (!input) return;
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyAllInputs();
        }
      });
    });

    inputs.optionType?.addEventListener('change', () => {
      const nextType = inputs.optionType.value === 'put' ? 'put' : 'call';
      if (state.pricingParams.optionType === nextType) return;
      state.pricingParams.optionType = nextType;
      syncInputs();
      rebuildBarsAndDraw();
    });

    const renderTopSpot = () => {
      if (!topInputs.spot) return;
      const min = Number(topInputs.spot.min || state.layoutParams.minStrike || 60);
      const max = Number(topInputs.spot.max || state.layoutParams.maxStrike || 140);
      const sourceValue = (document.activeElement === topInputs.spotValueInput)
        ? Number(topInputs.spotValueInput.value || state.pricingParams.spot || min)
        : Number(topInputs.spot.value || topInputs.spotValueInput?.value || state.pricingParams.spot || min);
      const numeric = clamp(sourceValue, min, max);
      state.pricingParams.spot = numeric;
      topInputs.spot.value = String(numeric);
      if (topInputs.spotValueInput && document.activeElement !== topInputs.spotValueInput) topInputs.spotValueInput.value = String(Math.round(numeric));
      if (topInputs.spotValue) topInputs.spotValue.textContent = String(Math.round(numeric));
      updateTopSliderVisual(topInputs.spot);
      rebuildBarsAndDraw();
    };
    topInputs.spot?.addEventListener('input', renderTopSpot);
    topInputs.spot?.addEventListener('change', renderTopSpot);
    topInputs.spotValueInput?.addEventListener('input', renderTopSpot);
    topInputs.spotValueInput?.addEventListener('change', renderTopSpot);
    topInputs.spotValueInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renderTopSpot();
      }
    });

    const renderTopElapsed = () => {
      if (!topInputs.elapsed) return;
      const min = Number(topInputs.elapsed.min || 0);
      const max = Number(topInputs.elapsed.max || state.layoutParams.maxDays || 360);
      const sourceValue = (document.activeElement === topInputs.elapsedValueInput)
        ? Number(topInputs.elapsedValueInput.value || state.pricingParams.elapsed || 0)
        : Number(topInputs.elapsed.value || topInputs.elapsedValueInput?.value || state.pricingParams.elapsed || 0);
      const numeric = clamp(sourceValue, min, max);
      state.pricingParams.elapsed = numeric;
      topInputs.elapsed.value = String(numeric);
      if (topInputs.elapsedValueInput && document.activeElement !== topInputs.elapsedValueInput) topInputs.elapsedValueInput.value = String(Math.round(numeric));
      if (topInputs.elapsedValue) topInputs.elapsedValue.textContent = `${Math.round(numeric)}天`;
      updateTopSliderVisual(topInputs.elapsed);
      rebuildBarsAndDraw();
    };
    topInputs.elapsed?.addEventListener('input', renderTopElapsed);
    topInputs.elapsed?.addEventListener('change', renderTopElapsed);
    topInputs.elapsedValueInput?.addEventListener('input', renderTopElapsed);
    topInputs.elapsedValueInput?.addEventListener('change', renderTopElapsed);
    topInputs.elapsedValueInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renderTopElapsed();
      }
    });

    if (topInputs.vol) {
      const renderTopVol = () => {
        const max = Math.max(15, Number(topInputs.volMax?.value || state.pricingParams.volMax || 90));
        state.pricingParams.volMax = max;
        if (topInputs.volMax && document.activeElement !== topInputs.volMax) topInputs.volMax.value = String(Math.round(max));
        topInputs.vol.min = '15';
        topInputs.vol.max = String(max);
        if (topInputs.volValueInput) {
          topInputs.volValueInput.min = '15';
          topInputs.volValueInput.max = String(max);
        }
        const sourceValue = (document.activeElement === topInputs.volValueInput)
          ? Number(topInputs.volValueInput.value || state.pricingParams.vol || 45)
          : Number(topInputs.vol.value || topInputs.volValueInput?.value || state.pricingParams.vol || 45);
        const numeric = clamp(sourceValue, 15, max);
        topInputs.vol.value = String(numeric);
        state.pricingParams.vol = numeric;
        if (topInputs.volValueInput && document.activeElement !== topInputs.volValueInput) topInputs.volValueInput.value = formatVolDisplay(numeric);
        if (topInputs.volMaxTick) topInputs.volMaxTick.textContent = String(Math.round(max));
        updateTopSliderVisual(topInputs.vol);
        rebuildBarsAndDraw();
      };
      topInputs.vol.addEventListener('input', renderTopVol);
      topInputs.vol.addEventListener('change', renderTopVol);
      topInputs.volValueInput?.addEventListener('input', renderTopVol);
      topInputs.volValueInput?.addEventListener('change', renderTopVol);
      topInputs.volValueInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          renderTopVol();
        }
      });
      topInputs.volMax?.addEventListener('input', renderTopVol);
      topInputs.volMax?.addEventListener('change', renderTopVol);
      topInputs.volMax?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          renderTopVol();
        }
      });
      renderTopVol();
    }
    renderTopSpot();
    renderTopElapsed();

    canvas.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', (event) => {
      endDrag(event, { allowLock: false });
      if (!hasLockedHover() && state.hoverMode) {
        state.hoverMode = null;
        state.hoverStrike = null;
        state.hoverDays = null;
        draw();
      }
    });
    canvas.addEventListener('dragstart', (e) => e.preventDefault());
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', (event) => {
      if (isOverlayControlEvent(event)) return;
      if (clearLockedHover(true)) {
        event.preventDefault();
        draw();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (view.classList.contains('active')) resizeCanvas();
    });
    resizeObserver.observe(view);

    const viewObserver = new MutationObserver(() => {
      if (view.classList.contains('active')) requestAnimationFrame(resizeCanvas);
    });
    viewObserver.observe(view, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', () => {
      if (view.classList.contains('active')) resizeCanvas();
    });

    let lastViewportMouseY = null;
    const updateBottomPeek = (clientY) => {
      if (!bottomControls) return;
      if (!view || !view.classList.contains('active')) {
        bottomControls.classList.remove('chain3d-bottom-peek');
        return;
      }
      const nearViewportBottom = Number.isFinite(clientY)
        && clientY >= (window.innerHeight - 86)
        && clientY <= (window.innerHeight + 8);
      const overPanel = !!bottomControls.matches(':hover');
      bottomControls.classList.toggle('chain3d-bottom-peek', nearViewportBottom || overPanel);
    };

    bottomInputs.showGrid?.addEventListener('change', () => {
      state.pricingParams.showGrid = !!bottomInputs.showGrid.checked;
      draw();
    });
    priceToggleInput?.addEventListener('change', () => {
      state.pricePanelChecked = !!priceToggleInput.checked;
      draw();
    });
    pricePanel?.addEventListener('mousedown', (event) => {
      startPricePanelDrag(event);
      event.stopPropagation();
    });
    pricePanel?.addEventListener('click', (event) => {
      if (pricePanelDragMoved) {
        event.preventDefault();
      }
      event.stopPropagation();
    });
    pricePanel?.addEventListener('mouseup', (event) => {
      endPricePanelDrag();
      event.stopPropagation();
    });

    window.addEventListener('mousemove', (event) => {
      movePricePanelDrag(event);
      lastViewportMouseY = event.clientY;
      updateBottomPeek(event.clientY);
    });
    window.addEventListener('mouseup', () => {
      endPricePanelDrag();
    });
    window.addEventListener('scroll', () => {
      updateBottomPeek(lastViewportMouseY);
    }, { passive: true });
    window.addEventListener('blur', () => {
      endPricePanelDrag();
      bottomControls?.classList.remove('chain3d-bottom-peek');
    });
    bottomControls?.addEventListener('mouseenter', () => {
      bottomControls.classList.add('chain3d-bottom-peek');
    });
    bottomControls?.addEventListener('mouseleave', () => {
      updateBottomPeek(lastViewportMouseY);
    });

    const overlayBlockers = [
      bubble,
      toggleBtn,
      dockBtn,
      topControls,
      topToggleBtn,
      topDockBtn,
      locatorBubble,
      locatorToggleBtn,
      locatorDockBtn,
      priceBoard,
      priceBoardToggleBtn,
      priceBoardDockBtn,
    ].filter(Boolean);

    const swallowOverlayInteraction = (event) => {
      cancelCanvasInteraction();
      const hoverCleared = clearTransientHoverIfNeeded();
      if (event.type === 'contextmenu') {
        event.preventDefault();
      }
      event.stopPropagation();
      if (hoverCleared) draw();
    };

    ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach((type) => {
      overlayBlockers.forEach((el) => {
        el.addEventListener(type, swallowOverlayInteraction);
      });
    });

    syncInputs();
    setPriceBoardCollapsed(false);
    updatePriceBoardReadout();
    requestAnimationFrame(syncPriceBoardPositions);
    if (view.classList.contains('active')) resizeCanvas();
  });
})();
