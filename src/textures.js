import * as THREE from "three";

export function createTextureGenerators({ renderer } = {}) {
  const _texCache = {};
  function _canvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }
  function _wrapIdx(v, n) {
    return ((v % n) + n) % n;
  }
  function _rgba(g, a) {
    return "rgba(" + g + "," + g + "," + g + "," + a + ")";
  }
  function _bumpToNormal(src, strength) {
    const S = src.width;
    const data = src.getContext("2d").getImageData(0, 0, S, S).data;
    const out = _canvas(S);
    const octx = out.getContext("2d");
    const img = octx.createImageData(S, S);
    const h = (x, y) => data[(_wrapIdx(y, S) * S + _wrapIdx(x, S)) * 4] / 255;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = (h(x - 1, y) - h(x + 1, y)) * strength;
        const ny = (h(x, y - 1) - h(x, y + 1)) * strength;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        const i = (y * S + x) * 4;
        img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  function _tex(canvas, repeat, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat || 1, repeat || 1);
    try {
      t.anisotropy = Math.min(
        8,
        renderer?.capabilities?.getMaxAnisotropy?.() || 8,
      );
    } catch {}
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function floorMaps() {
    if (_texCache.floor) return _texCache.floor;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#1e242c";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = _rgba(50 + ((Math.random() * 40) | 0), 0.15);
      ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    _texCache.floor = _tex(c, 8, true);
    return _texCache.floor;
  }

  function castMaps() {
    if (_texCache.cast) return _texCache.cast;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#909090";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 12000; i++) {
      ctx.fillStyle = _rgba(70 + ((Math.random() * 110) | 0), 0.4);
      ctx.beginPath();
      ctx.arc(
        Math.random() * S,
        Math.random() * S,
        Math.random() * 2.3 + 0.35,
        0,
        6.2832,
      );
      ctx.fill();
    }
    _texCache.cast = {
      rough: _tex(c, 4),
      normal: _tex(_bumpToNormal(c, 2.4), 4),
    };
    return _texCache.cast;
  }

  function machinedMaps() {
    if (_texCache.mach) return _texCache.mach;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#b8b8b8";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2400; i++) {
      const y = Math.random() * S;
      ctx.strokeStyle = _rgba(130 + ((Math.random() * 110) | 0), 0.3);
      ctx.lineWidth = Math.random() * 1.3 + 0.25;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y + (Math.random() - 0.5) * 2.5);
      ctx.stroke();
    }
    _texCache.mach = {
      rough: _tex(c, 3),
      normal: _tex(_bumpToNormal(c, 0.8), 3),
    };
    return _texCache.mach;
  }

  function rubberMaps() {
    if (_texCache.rub) return _texCache.rub;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 24000; i++) {
      ctx.fillStyle = _rgba(150 + ((Math.random() * 105) | 0), 0.28);
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    _texCache.rub = {
      rough: _tex(c, 6),
      normal: _tex(_bumpToNormal(c, 0.7), 6),
    };
    return _texCache.rub;
  }

  function treadMaps() {
    if (_texCache.tread) return _texCache.tread;
    const S = 256,
      c = _canvas(S),
      ctx = c.getContext("2d");
    ctx.fillStyle = "#b4b4b4";
    ctx.fillRect(0, 0, S, S);
    [0.32, 0.5, 0.68].forEach((v) => {
      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(0, v * S - S * 0.028, S, S * 0.056);
    });
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = "#303030";
      ctx.fillRect(i * S * 0.5 + S * 0.12, S * 0.18, S * 0.09, S * 0.64);
    }
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(0, 0, S, S * 0.13);
    ctx.fillRect(0, S * 0.87, S, S * 0.13);
    const n = _tex(_bumpToNormal(c, 3.0));
    n.repeat.set(18, 1);
    const r = _tex(c);
    r.repeat.set(18, 1);
    _texCache.tread = { normal: n, rough: r };
    return _texCache.tread;
  }

  function discMaps() {
    if (_texCache.disc) return _texCache.disc;
    const S = 512;
    const c = _canvas(S),
      ctx = c.getContext("2d");
    const rc = _canvas(S),
      rctx = rc.getContext("2d");
    const cx = S / 2,
      cy = S / 2;
    ctx.fillStyle = "#1b1e22";
    ctx.fillRect(0, 0, S, S);
    rctx.fillStyle = "#d8d8d8";
    rctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(cx, cy, S * 0.17, cx, cy, S * 0.5);
    g.addColorStop(0, "#5f666d");
    g.addColorStop(0.12, "#99a1a9");
    g.addColorStop(0.75, "#8d949b");
    g.addColorStop(0.97, "#6d747b");
    g.addColorStop(1, "#3a3f45");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.5, 0, 6.2832);
    ctx.fill();
    rctx.fillStyle = "#606060";
    rctx.beginPath();
    rctx.arc(cx, cy, S * 0.5, 0, 6.2832);
    rctx.fill();
    for (let r = S * 0.22; r < S * 0.49; r += 1.6) {
      const gv = 110 + ((Math.random() * 110) | 0);
      ctx.strokeStyle = _rgba(gv, 0.28);
      ctx.lineWidth = Math.random() * 1.1 + 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.stroke();
      rctx.strokeStyle = _rgba(((Math.random() * 80) | 0) + 40, 0.4);
      rctx.lineWidth = 1;
      rctx.beginPath();
      rctx.arc(cx, cy, r, 0, 6.2832);
      rctx.stroke();
    }
    const holes = 40;
    for (let i = 0; i < holes; i++) {
      const a = (i / holes) * 6.2832;
      for (let s = 0; s < 3; s++) {
        const rad = S * 0.26 + s * S * 0.08 + Math.sin(a * 4) * 4;
        const x = cx + Math.cos(a) * rad,
          y = cy + Math.sin(a) * rad;
        ctx.fillStyle = "#09090b";
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, 6.2832);
        ctx.fill();
        rctx.fillStyle = "#222";
        rctx.beginPath();
        rctx.arc(x, y, 4.2, 0, 6.2832);
        rctx.fill();
      }
    }
    ctx.fillStyle = "#24282f";
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.17, 0, 6.2832);
    ctx.fill();
    rctx.fillStyle = "#2a2a2a";
    rctx.beginPath();
    rctx.arc(cx, cy, S * 0.17, 0, 6.2832);
    rctx.fill();
    const map = _tex(c, 1, true);
    const rough = _tex(rc, 1);
    _texCache.disc = { map, rough };
    return _texCache.disc;
  }

  return { castMaps, machinedMaps, rubberMaps, treadMaps, discMaps, floorMaps };
}
