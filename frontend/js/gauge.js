'use strict';

/**
 * gauge.js — River staff gauge year-timeline for Flood Map.
 *
 * Exposes FM.gauge = { init(), setYears(years), selectYear(year), setWaterLevel(year) }
 *
 * SVG structure (vertical / desktop):
 *   <svg role="listbox">
 *     <defs>
 *       <filter id="fm-gauge-texture"> … feTurbulence worn-paint edge </filter>
 *       <clipPath id="fm-gauge-water-clip"> … </clipPath>
 *     </defs>
 *     <g class="fm-gauge-bands">   <!-- alternating dark/mist painted bands -->
 *     <g class="fm-gauge-pole-edge"> <!-- thin irregular worn-edge path -->
 *     <g class="fm-gauge-water">   <!-- water fill + wave line -->
 *     <g class="fm-gauge-ticks">   <!-- tick marks -->
 *     <g class="fm-gauge-labels">  <!-- year labels + "No satellite record" -->
 *   </svg>
 *
 * Horizontal / mobile layout mirrors the same groups, rotated via viewBox + transform.
 */

window.FM = window.FM || {};

FM.gauge = (function () {

  /* ── constants ──────────────────────────────────────────────── */
  const POLE_W        = 48;
  const UNIT_H        = 56;          // px per year band (desktop)
  const TICK_MAJOR_W  = 20;
  const TICK_MINOR_W  = 10;
  const TICK_H_MAJOR  = 3;
  const TICK_H_MINOR  = 1.5;
  const LABEL_X       = POLE_W + TICK_MAJOR_W + 22;
  const WAVE_AMP      = 3;           // px amplitude
  const WAVE_PERIOD_MS = 4000;
  const WATER_ANIM_MS = 600;

  const COL_DARK      = '#14302E';
  const COL_MIST      = '#E4EBE5';
  const COL_GOLD      = '#B8892B';
  const COL_WATER     = '#4A8FA8';
  const COL_FADED_BG  = '#C8CECC';   // desaturated mist
  const COL_FADED_LBL = '#8FA09C';
  const COL_WHITE_LBL = '#E4EBE5';

  const NS = 'http://www.w3.org/2000/svg';

  /* ── state ──────────────────────────────────────────────────── */
  let _rail        = null;
  let _svg         = null;
  let _allYears    = [];   // full range min..max
  let _dataYears   = [];   // years with actual records
  let _selectableYears = [];
  let _activeYear  = null;
  let _isMobile    = false;

  // Water animation
  let _waterTargetY  = 0;   // target water top (SVG coords)
  let _waterCurrentY = 0;
  let _waterAnimStart = null;
  let _waterAnimFrom  = 0;
  let _rafId         = null;

  // Wave animation
  let _waveOffset = 0;
  let _lastTs     = 0;
  let _waveEl     = null;
  let _waterFillEl = null;
  let _waterClipRect = null;

  /* ── SVG helpers ─────────────────────────────────────────────── */
  function el(tag, attrs, ...children) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    for (const c of children) if (c) e.appendChild(c);
    return e;
  }

  function svgText(x, y, content, attrs) {
    const t = el('text', { x, y, ...attrs });
    t.textContent = content;
    return t;
  }

  /* ── build year range ────────────────────────────────────────── */
  function _buildYearRange(dataYears) {
    if (!dataYears || !dataYears.length) return [];
    const mn = Math.min(...dataYears);
    const mx = Math.max(...dataYears);
    const all = [];
    for (let y = mn; y <= mx; y++) all.push(y);
    return all;
  }

  /* ── irregular worn-edge path ────────────────────────────────── */
  function _wornEdgePath(totalH) {
    // Left edge: a slightly wobbly path the full height of the pole
    // right edge the same, reversed — gives a weathered painted-metal feel
    const pts = [];
    const steps = Math.ceil(totalH / 12);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = t * totalH;
      const jL = (Math.sin(i * 2.3) * 0.6 + Math.cos(i * 1.7) * 0.4);  // ±1px
      const jR = (Math.sin(i * 1.9 + 1) * 0.6 + Math.cos(i * 2.5) * 0.4);
      pts.push({ y, jL, jR });
    }
    // Left edge path
    let d = `M ${pts[0].jL} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].jL} ${pts[i].y}`;
    // Right edge path
    d += ` M ${POLE_W + pts[0].jR} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${POLE_W + pts[i].jR} ${pts[i].y}`;
    return d;
  }

  /* ── wave path ───────────────────────────────────────────────── */
  function _buildWavePath(offsetX, waterY, width) {
    // Single sine wave across the pole width, shifted by offsetX
    const cycles = 2;
    const pts = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * width;
      const phase = ((x + offsetX) / width) * cycles * Math.PI * 2;
      const y = waterY + Math.sin(phase) * WAVE_AMP;
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return pts.join(' ');
  }

  /* ── easing ──────────────────────────────────────────────────── */
  function _easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /* ── main render loop (wave + water animation) ───────────────── */
  function _loop(ts) {
    _rafId = requestAnimationFrame(_loop);
    const dt = ts - (_lastTs || ts);
    _lastTs = ts;

    // Wave offset
    _waveOffset += (dt / WAVE_PERIOD_MS) * (_isMobile ? _gaugeW() : POLE_W) * 2;

    // Water level animation
    if (_waterAnimStart !== null) {
      const elapsed = ts - _waterAnimStart;
      const prog = Math.min(elapsed / WATER_ANIM_MS, 1);
      const eased = _easeInOut(prog);
      _waterCurrentY = _waterAnimFrom + (_waterTargetY - _waterAnimFrom) * eased;
      if (prog >= 1) _waterAnimStart = null;
    }

    _updateWaterDOM();
  }

  function _gaugeW() {
    return _rail ? _rail.getBoundingClientRect().width : POLE_W;
  }

  /* ── update water DOM ────────────────────────────────────────── */
  function _updateWaterDOM() {
    if (!_svg) return;
    const totalH = _allYears.length * UNIT_H;
    const poleW  = POLE_W;
    const curY   = _waterCurrentY;

    if (_waterClipRect) {
      if (_isMobile) {
        _waterClipRect.setAttribute('width', Math.max(0, curY));
        _waterClipRect.setAttribute('height', poleW);
      } else {
        _waterClipRect.setAttribute('y', curY);
        _waterClipRect.setAttribute('height', Math.max(0, totalH - curY));
      }
    }

    if (_waveEl) {
      if (_isMobile) {
        const wavePath = _buildWavePath(_waveOffset, curY, poleW);
        _waveEl.setAttribute('d', wavePath);
      } else {
        const wavePath = _buildWavePath(_waveOffset, curY, poleW);
        _waveEl.setAttribute('d', wavePath);
      }
    }
  }

  /* ── compute water Y for a given year ───────────────────────── */
  function _waterYForYear(year) {
    // Water fills from the bottom of the gauge UP to the selected year's midpoint
    const idx = _allYears.indexOf(year);
    if (idx < 0) return _allYears.length * UNIT_H; // bottom
    // In SVG, top is 0, bottom is totalH. Water top = midpoint of year band.
    const bandMid = (idx + 0.5) * UNIT_H;
    return bandMid;
  }

  /* ── render SVG ──────────────────────────────────────────────── */
  function _render() {
    if (!_rail) return;
    _rail.innerHTML = '';

    _isMobile = window.innerWidth <= 768;

    const years   = _allYears;
    const count   = years.length;
    if (!count) return;

    const totalH  = count * UNIT_H;
    const svgW    = _isMobile ? '100%' : (POLE_W + TICK_MAJOR_W + 100);
    const svgH    = _isMobile ? (POLE_W + TICK_MAJOR_W + 60) : totalH;

    // For mobile, horizontal layout: years scroll left, water fills from left
    const viewBox = _isMobile
      ? `0 0 ${count * UNIT_H} ${POLE_W + TICK_MAJOR_W + 60}`
      : `0 0 ${POLE_W + TICK_MAJOR_W + 100} ${totalH}`;

    _svg = el('svg', {
      viewBox,
      width: svgW,
      height: svgH,
      role: 'listbox',
      'aria-label': 'Year timeline',
      'aria-orientation': _isMobile ? 'horizontal' : 'vertical',
      tabindex: '0',
      style: 'display:block;overflow:visible;'
    });

    // ── DEFS ──────────────────────────────────────────────────────
    const defs = el('defs');

    // Water clip path: hides water fill below/above appropriate level
    const clipId = 'fm-gauge-water-clip';
    const clipPath = el('clipPath', { id: clipId });
    if (_isMobile) {
      _waterClipRect = el('rect', { x: 0, y: 0, width: 0, height: POLE_W });
    } else {
      _waterClipRect = el('rect', {
        x: 0,
        y: _waterCurrentY,
        width: POLE_W,
        height: Math.max(0, totalH - _waterCurrentY)
      });
    }
    clipPath.appendChild(_waterClipRect);
    defs.appendChild(clipPath);

    // Worn-paint edge filter: very subtle displacement
    const filterId = 'fm-gauge-edge';
    const filt = el('filter', { id: filterId, x: '-10%', width: '120%', y: '0%', height: '100%', filterUnits: 'userSpaceOnUse' });
    filt.appendChild(el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9 0.03', numOctaves: '3', seed: '7', result: 'noise' }));
    filt.appendChild(el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: '1.2', xChannelSelector: 'R', yChannelSelector: 'G' }));
    defs.appendChild(filt);

    _svg.appendChild(defs);

    // ── BANDS GROUP ───────────────────────────────────────────────
    const gBands = el('g', { class: 'fm-gauge-bands' });

    years.forEach((year, i) => {
      const hasData   = _dataYears.includes(year);
      const isActive  = year === _activeYear;
      const y0        = _isMobile ? 0 : i * UNIT_H;
      const x0        = _isMobile ? i * UNIT_H : 0;

      let bandFill;
      if (!hasData) {
        bandFill = COL_FADED_BG;
      } else if (i % 2 === 0) {
        bandFill = COL_DARK;
      } else {
        bandFill = COL_MIST;
      }

      // The painted band
      const band = _isMobile
        ? el('rect', { x: x0, y: y0, width: UNIT_H, height: POLE_W, fill: bandFill, 'data-year': year })
        : el('rect', { x: x0, y: y0, width: POLE_W, height: UNIT_H, fill: bandFill, 'data-year': year });

      gBands.appendChild(band);

      // Gold stripe at every other tick (like half-metre mark on real gauge)
      if (i % 2 === 1 && hasData) {
        const stripe = _isMobile
          ? el('rect', { x: x0 + UNIT_H / 2 - 1, y: 0, width: 2, height: POLE_W, fill: COL_GOLD, opacity: '0.55' })
          : el('rect', { x: 0, y: y0 + UNIT_H / 2 - 1, width: POLE_W, height: 2, fill: COL_GOLD, opacity: '0.55' });
        gBands.appendChild(stripe);
      }

      // Active year highlight band overlay
      if (isActive) {
        const hl = _isMobile
          ? el('rect', { x: x0, y: y0, width: UNIT_H, height: POLE_W, fill: 'none', stroke: COL_GOLD, 'stroke-width': '2', rx: '1' })
          : el('rect', { x: x0, y: y0, width: POLE_W, height: UNIT_H, fill: 'none', stroke: COL_GOLD, 'stroke-width': '2', rx: '1' });
        gBands.appendChild(hl);
      }
    });

    _svg.appendChild(gBands);

    // ── WATER GROUP ───────────────────────────────────────────────
    const gWater = el('g', { class: 'fm-gauge-water', 'clip-path': `url(#${clipId})` });

    // Solid water fill rect (always full pole, clipped)
    const waterFill = _isMobile
      ? el('rect', { x: 0, y: 0, width: count * UNIT_H, height: POLE_W, fill: COL_WATER, opacity: '0.72' })
      : el('rect', { x: 0, y: 0, width: POLE_W, height: totalH, fill: COL_WATER, opacity: '0.72' });
    _waterFillEl = waterFill;
    gWater.appendChild(waterFill);

    _svg.appendChild(gWater);

    // ── WAVE LINE (outside clip, at water surface) ─────────────────
    // Wave sits on TOP of everything, unclipped, only visible at water surface
    _waveEl = el('path', {
      d: _buildWavePath(_waveOffset, _waterCurrentY, POLE_W),
      fill: 'none',
      stroke: COL_WATER,
      'stroke-width': '1.5',
      opacity: '0.85'
    });
    _svg.appendChild(_waveEl);

    // ── WORN POLE EDGES ────────────────────────────────────────────
    const edgeGroup = el('g', { class: 'fm-gauge-pole-edge', filter: `url(#${filterId})`, opacity: '0.35' });
    // Overlay a thin dark path along left+right edges
    const edgePath = el('path', {
      d: _wornEdgePath(totalH),
      fill: 'none',
      stroke: '#0a1a18',
      'stroke-width': '2'
    });
    edgeGroup.appendChild(edgePath);
    _svg.appendChild(edgeGroup);

    // ── TICKS GROUP ────────────────────────────────────────────────
    const gTicks = el('g', { class: 'fm-gauge-ticks' });

    years.forEach((year, i) => {
      const hasData = _dataYears.includes(year);
      // Major tick at the year mark (centre of band)
      const bandMid = (i + 0.5) * UNIT_H;
      const tW = hasData ? TICK_MAJOR_W : TICK_MINOR_W;
      const tH = hasData ? TICK_H_MAJOR : TICK_H_MINOR;
      const tCol = hasData ? (i % 2 === 0 ? COL_MIST : COL_DARK) : COL_FADED_LBL;

      let tick;
      if (_isMobile) {
        tick = el('rect', {
          x: bandMid - tH / 2,
          y: POLE_W,
          width: tH,
          height: tW,
          fill: tCol
        });
      } else {
        tick = el('rect', {
          x: POLE_W,
          y: bandMid - tH / 2,
          width: tW,
          height: tH,
          fill: tCol
        });
      }
      gTicks.appendChild(tick);
    });

    _svg.appendChild(gTicks);

    // ── LABELS GROUP ───────────────────────────────────────────────
    const gLabels = el('g', { class: 'fm-gauge-labels', 'font-family': '"Noto Serif", Georgia, serif' });

    years.forEach((year, i) => {
      const hasData   = _dataYears.includes(year);
      const isActive  = year === _activeYear;
      const isCurrentYear = year === new Date().getFullYear();
      const bandMid   = (i + 0.5) * UNIT_H;

      const labelX = _isMobile ? bandMid : LABEL_X;
      const labelY = _isMobile ? (POLE_W + TICK_MAJOR_W + 16) : (bandMid + 5);

      let fill, weight;
      if (!hasData) {
        fill = COL_FADED_LBL; weight = '400';
      } else if (isCurrentYear) {
        fill = COL_GOLD; weight = '700';
      } else if (isActive) {
        fill = COL_WHITE_LBL; weight = '700';
      } else {
        fill = COL_WHITE_LBL; weight = '600';
      }

      const yearLabel = svgText(labelX, labelY, String(year), {
        'font-size': '14',
        'font-weight': weight,
        fill,
        'text-anchor': 'middle',
        'pointer-events': hasData ? 'all' : 'none',
        role: 'option',
        'aria-selected': isActive ? 'true' : 'false',
        'aria-disabled': hasData ? 'false' : 'true',
        'data-year': year,
        style: hasData ? 'cursor:pointer' : 'cursor:default'
      });

      gLabels.appendChild(yearLabel);

      // "No satellite record" italic sub-label
      if (!hasData) {
        const subY = _isMobile ? (labelY + 14) : (labelY + 14);
        const sub = svgText(labelX, subY, 'No satellite record', {
          'font-size': '9',
          'font-style': 'italic',
          fill: COL_FADED_LBL,
          'text-anchor': 'middle',
          'pointer-events': 'none'
        });
        gLabels.appendChild(sub);
      }

      // Hover group (interactive overlay rect for selectable years)
      if (hasData) {
        let hoverRect;
        if (_isMobile) {
          hoverRect = el('rect', {
            x: bandMid - UNIT_H / 2,
            y: 0,
            width: UNIT_H,
            height: POLE_W,
            fill: 'transparent',
            'data-year': year,
            style: 'cursor:pointer',
            role: 'option',
            'aria-selected': isActive ? 'true' : 'false',
            tabindex: '-1'
          });
        } else {
          hoverRect = el('rect', {
            x: 0,
            y: i * UNIT_H,
            width: POLE_W + TICK_MAJOR_W + 90,
            height: UNIT_H,
            fill: 'transparent',
            'data-year': year,
            style: 'cursor:pointer',
            role: 'option',
            'aria-selected': isActive ? 'true' : 'false',
            tabindex: '-1'
          });
        }
        // Hover effect: gold band highlight on mouseenter
        hoverRect.addEventListener('mouseenter', () => {
          hoverRect.setAttribute('fill', 'rgba(184,137,43,0.12)');
        });
        hoverRect.addEventListener('mouseleave', () => {
          hoverRect.setAttribute('fill', 'transparent');
        });
        hoverRect.addEventListener('click', () => {
          FM.gauge.selectYear(year);
        });
        gLabels.appendChild(hoverRect);
      }
    });

    _svg.appendChild(gLabels);

    _rail.appendChild(_svg);

    // Set initial water level
    if (_activeYear) {
      _waterCurrentY = _waterYForYear(_activeYear);
      _waterTargetY  = _waterCurrentY;
      _updateWaterDOM();
    }
  }

  /* ── keyboard navigation ─────────────────────────────────────── */
  function _onKeyDown(e) {
    if (!_selectableYears.length) return;
    const curIdx = _selectableYears.indexOf(_activeYear);
    let next = _activeYear;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      next = curIdx < _selectableYears.length - 1
        ? _selectableYears[curIdx + 1]
        : _selectableYears[0];
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      next = curIdx > 0
        ? _selectableYears[curIdx - 1]
        : _selectableYears[_selectableYears.length - 1];
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (_activeYear) FM.gauge.selectYear(_activeYear);
      return;
    } else {
      return;
    }

    FM.gauge.selectYear(next);
  }

  /* ── responsive resize handler ───────────────────────────────── */
  let _resizeTimer = null;
  function _onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const mobile = window.innerWidth <= 768;
      if (mobile !== _isMobile) _render();
    }, 200);
  }

  /* ── public API ──────────────────────────────────────────────── */

  function init() {
    _rail = document.getElementById('gauge-rail');
    if (!_rail) {
      console.warn('[gauge] #gauge-rail not found');
      return;
    }

    // Start rAF loop
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(_loop);

    // Keyboard
    window.addEventListener('keydown', _onKeyDown);
    window.addEventListener('resize', _onResize);

    // State subscription
    if (FM.state && FM.state.on) {
      FM.state.on('activeYear', (year) => {
        _activeYear = year;
        FM.gauge.setWaterLevel(year);
        _render();
      });
    }

    // If DATA_YEARS already populated, initialise now
    if (typeof DATA_YEARS !== 'undefined' && DATA_YEARS.length) {
      FM.gauge.setYears(DATA_YEARS);
    }
  }

  function setYears(years) {
    _dataYears       = Array.isArray(years) ? years.slice().sort((a, b) => a - b) : [];
    _allYears        = _buildYearRange(_dataYears);
    _selectableYears = _dataYears.slice().sort((a, b) => a - b);

    // Default active year: most recent selectable
    if (!_activeYear && _selectableYears.length) {
      _activeYear = _selectableYears[_selectableYears.length - 1];
    }

    // Sync state without triggering re-render loop (setYears is called once from api.js)
    if (FM.state && FM.state.set && _activeYear) {
      FM.state.set('activeYear', _activeYear);
    }

    _waterCurrentY = _waterYForYear(_activeYear);
    _waterTargetY  = _waterCurrentY;

    _render();
  }

  function selectYear(year) {
    if (!_selectableYears.includes(year)) return;
    _activeYear = year;
    if (FM.state && FM.state.set) {
      FM.state.set('activeYear', year);
    }
    // Water animation
    const targetY = _waterYForYear(year);
    _waterAnimFrom  = _waterCurrentY;
    _waterTargetY   = targetY;
    _waterAnimStart = performance.now();
    // Re-render labels/highlights
    _render();
  }

  function setWaterLevel(year) {
    const targetY = _waterYForYear(year);
    _waterAnimFrom  = _waterCurrentY;
    _waterTargetY   = targetY;
    _waterAnimStart = performance.now();
  }

  return { init, setYears, selectYear, setWaterLevel };

}());
