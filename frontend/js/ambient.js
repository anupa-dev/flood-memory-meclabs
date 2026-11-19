// ambient.js — Kettuvallam houseboat, coconut palm fronds, monsoon rain
// FM.ambient: manages Kerala ambient world elements.

'use strict';

window.FM = window.FM || {};

FM.ambient = (function () {

  let _rainCanvas = null;
  let _rainCtx = null;
  let _rainRafId = null;
  let _rainDrops = [];
  let _targetDropCount = 8;
  let _currentDropCount = 8;
  let _isReducedMotion = false;

  // ── Rain canvas simulation ────────────────────────────────────────────────
  function _initRain() {
    _rainCanvas = document.getElementById('rain-canvas');
    if (!_rainCanvas) {
      _rainCanvas = document.createElement('canvas');
      _rainCanvas.id = 'rain-canvas';
      _rainCanvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(_rainCanvas);
    }

    _rainCtx = _rainCanvas.getContext('2d');
    _resizeRainCanvas();
    window.addEventListener('resize', _resizeRainCanvas);

    // Initial drops pool
    _rainDrops = [];
    for (let i = 0; i < 120; i++) {
      _rainDrops.push(_createRainDrop());
    }

    _rainRafId = requestAnimationFrame(_rainLoop);

    // Occasional brief gentle monsoon showers every 75 seconds
    setInterval(function () {
      if (_isReducedMotion) return;
      _targetDropCount = 28;
      setTimeout(function () {
        _targetDropCount = 8;
      }, 4500);
    }, 75000);
  }

  function _resizeRainCanvas() {
    if (!_rainCanvas) return;
    _rainCanvas.width = window.innerWidth;
    _rainCanvas.height = window.innerHeight;
  }

  function _createRainDrop(spawnAtTop) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      x: Math.random() * (w + 100) - 50,
      y: spawnAtTop ? (Math.random() * -60 - 10) : (Math.random() * h),
      length: 4 + Math.random() * 5, // 4-9px short streaks
      speed: 12 + Math.random() * 8, // fast diagonal fall
      opacity: 0.08 + Math.random() * 0.10 // very faint 0.08-0.18
    };
  }

  function _rainLoop() {
    if (_isReducedMotion) return;

    _rainRafId = requestAnimationFrame(_rainLoop);

    if (!_rainCtx || !_rainCanvas) return;

    const w = _rainCanvas.width;
    const h = _rainCanvas.height;

    _rainCtx.clearRect(0, 0, w, h);

    // Interpolate current drop count toward target
    if (_currentDropCount < _targetDropCount) {
      _currentDropCount = Math.min(_targetDropCount, _currentDropCount + 1);
    } else if (_currentDropCount > _targetDropCount) {
      _currentDropCount = Math.max(_targetDropCount, _currentDropCount - 1);
    }

    const angle = 0.22; // ~13 degrees tilt from vertical
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);

    for (let i = 0; i < _currentDropCount; i++) {
      const drop = _rainDrops[i];
      if (!drop) continue;

      drop.x += dx * drop.speed;
      drop.y += dy * drop.speed;

      if (drop.y > h + 20 || drop.x > w + 50) {
        Object.assign(drop, _createRainDrop(true));
      }

      _rainCtx.beginPath();
      _rainCtx.moveTo(drop.x, drop.y);
      _rainCtx.lineTo(drop.x + dx * drop.length, drop.y + dy * drop.length);
      _rainCtx.strokeStyle = `rgba(228, 235, 229, ${drop.opacity})`;
      _rainCtx.lineWidth = 1;
      _rainCtx.stroke();
    }
  }

  function startRain(density) {
    _targetDropCount = density || 75;
    _currentDropCount = density || 75;
  }

  function setRainDensity(density) {
    _targetDropCount = density;
  }

  // ── Palm fronds (corners) ─────────────────────────────────────────────────
  function _createPalmFrondSVG() {
    // Detailed Kerala coconut palm frond silhouette
    return `
      <g fill="#102523" opacity="0.88">
        <!-- Main frond spine -->
        <path d="M 0 0 C 40 30, 100 80, 190 140 C 140 100, 70 50, 0 0 Z" />
        <!-- Individual curved palm leaflets -->
        <path d="M 30 18 C 45 42, 60 75, 65 110 C 60 78, 48 45, 30 18 Z" opacity="0.9" />
        <path d="M 50 32 C 72 65, 95 105, 105 145 C 96 108, 75 68, 50 32 Z" opacity="0.9" />
        <path d="M 75 48 C 105 88, 135 135, 148 175 C 137 137, 108 90, 75 48 Z" opacity="0.9" />
        <path d="M 105 68 C 140 110, 175 155, 190 195 C 178 158, 144 112, 105 68 Z" opacity="0.95" />
        <path d="M 135 90 C 172 130, 205 170, 225 210 C 210 172, 178 132, 135 90 Z" opacity="0.95" />
        <path d="M 165 115 C 200 152, 230 188, 250 220 C 235 188, 206 153, 165 115 Z" opacity="0.9" />
      </g>
    `;
  }

  function _initPalms() {
    // Top-left palm layer
    const tl = document.createElement('div');
    tl.className = 'palm-layer palm-layer--top-left';
    tl.setAttribute('aria-hidden', 'true');
    tl.innerHTML = `
      <svg viewBox="0 0 260 240" width="100%" height="100%" style="overflow:visible;">
        <g class="palm-sway-2" opacity="0.65" transform="scale(0.85) rotate(-8)">
          ${_createPalmFrondSVG()}
        </g>
        <g class="palm-sway-1" transform="scale(1.05)">
          ${_createPalmFrondSVG()}
        </g>
      </svg>
    `;
    document.body.appendChild(tl);

    // Top-right palm layer (flipped)
    const tr = document.createElement('div');
    tr.className = 'palm-layer palm-layer--top-right';
    tr.setAttribute('aria-hidden', 'true');
    tr.innerHTML = `
      <svg viewBox="0 0 260 240" width="100%" height="100%" style="overflow:visible;">
        <g class="palm-sway-3" transform="scale(-0.95, 0.95) translate(-250, 0)">
          ${_createPalmFrondSVG()}
        </g>
      </svg>
    `;
    document.body.appendChild(tr);
  }

  // ── Kettuvallam (Kerala Houseboat) ─────────────────────────────────────────
  function _initKettuvallam() {
    const wrap = document.createElement('div');
    wrap.id = 'kettuvallam-wrap';
    wrap.className = 'kettuvallam-active';
    wrap.setAttribute('aria-hidden', 'true');

    // Meticulously hand-drawn SVG silhouette of a Kerala Kettuvallam:
    // Curved wood hull bound with coir rope, arched woven valavara canopy roof, pilot bow, lantern.
    wrap.innerHTML = `
      <div class="kettuvallam-bob">
        <!-- Main boat -->
        <svg viewBox="0 0 160 55" width="160" height="55" style="overflow:visible;">
          <!-- Hull: curved wooden bottom with sharp upturned prow and stern -->
          <path d="M 6 36 C 24 43, 136 43, 154 36 C 146 39, 14 39, 6 36 Z" fill="#0E2321" />
          <path d="M 8 35 C 32 41, 128 41, 152 35 L 146 29 C 120 31, 40 31, 14 29 Z" fill="#14302E" stroke="#B8892B" stroke-width="0.8" />
          <!-- Coir tied bands along hull -->
          <line x1="25" y1="30" x2="23" y2="39" stroke="#B8892B" stroke-width="0.75" opacity="0.7"/>
          <line x1="45" y1="31" x2="44" y2="40" stroke="#B8892B" stroke-width="0.75" opacity="0.7"/>
          <line x1="75" y1="31" x2="75" y2="40" stroke="#B8892B" stroke-width="0.75" opacity="0.7"/>
          <line x1="105" y1="31" x2="106" y2="40" stroke="#B8892B" stroke-width="0.75" opacity="0.7"/>
          <line x1="130" y1="30" x2="132" y2="39" stroke="#B8892B" stroke-width="0.75" opacity="0.7"/>

          <!-- Valavara arched woven bamboo/palm canopy roof -->
          <path d="M 32 29 C 34 14, 122 14, 126 29 Z" fill="#254340" stroke="#B8892B" stroke-width="0.9"/>
          <!-- Canopy ribbed curves -->
          <path d="M 46 29 C 47 17, 59 17, 60 29" fill="none" stroke="#B8892B" stroke-width="0.6" opacity="0.75"/>
          <path d="M 68 29 C 69 16, 85 16, 86 29" fill="none" stroke="#B8892B" stroke-width="0.6" opacity="0.75"/>
          <path d="M 94 29 C 95 17, 108 17, 109 29" fill="none" stroke="#B8892B" stroke-width="0.6" opacity="0.75"/>

          <!-- Open cabin windows / wooden slats -->
          <rect x="48" y="22" width="9" height="6" rx="1" fill="#E4EBE5" opacity="0.8"/>
          <rect x="66" y="22" width="11" height="6" rx="1" fill="#E4EBE5" opacity="0.8"/>
          <rect x="86" y="22" width="11" height="6" rx="1" fill="#E4EBE5" opacity="0.8"/>
          <rect x="104" y="22" width="9" height="6" rx="1" fill="#E4EBE5" opacity="0.8"/>

          <!-- Pilot bow platform & steering oar pole -->
          <line x1="14" y1="29" x2="28" y2="29" stroke="#0E2321" stroke-width="1.8"/>
          <line x1="12" y1="32" x2="2" y2="44" stroke="#B8892B" stroke-width="1.2" stroke-linecap="round"/>
          <circle cx="2" cy="44" r="1.5" fill="#7FA9A6"/>

          <!-- Small brass warm lantern at stern -->
          <line x1="138" y1="28" x2="138" y2="24" stroke="#B8892B" stroke-width="0.9"/>
          <circle cx="138" cy="23" r="1.8" fill="#B8892B" opacity="0.95"/>
        </svg>

        <!-- Soft water reflection -->
        <div class="kettuvallam-reflection">
          <svg viewBox="0 0 160 30" width="160" height="30">
            <path d="M 8 2 C 32 10, 128 10, 152 2 C 120 7, 40 7, 8 2 Z" fill="#7FA9A6" />
          </svg>
        </div>
      </div>
    `;

    document.body.appendChild(wrap);
  }

  function init() {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    _isReducedMotion = mql.matches;
    mql.addEventListener('change', (e) => {
      _isReducedMotion = e.matches;
      if (_isReducedMotion && _rainRafId) {
        cancelAnimationFrame(_rainRafId);
      } else if (!_isReducedMotion) {
        _rainRafId = requestAnimationFrame(_rainLoop);
      }
    });

    if (!_isReducedMotion) {
      _initRain();
      _initPalms();
      _initKettuvallam();
    }
  }

  return {
    init,
    startRain,
    setRainDensity
  };

})();

