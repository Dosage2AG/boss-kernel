/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. VISUAL FX — Cascade Pulses, Gravity, Whale Shockwaves
   Runs on the canvas alongside the star rendering
   ══════════════════════════════════════════════════════════════════ */

class VisualFX {
  constructor(ctx, cam) {
    this.ctx = ctx;
    this.cam = cam;
    this.pulses = [];       // cascade pulse traveling along bond
    this.shockwaves = [];   // whale detection expanding rings
    this.particles = [];    // profit/loss particle burst
  }

  // ── Cascade Pulse — light traveling along a bond ──────────────
  addCascadePulse(fromStar, toStar, duration) {
    this.pulses.push({
      from: fromStar, to: toStar,
      progress: 0,          // 0 to 1
      speed: 1 / (duration || 3000), // complete in duration ms
      startTime: Date.now(),
      color: fromStar.dir === 'BULL' ? [0, 255, 200] : [255, 80, 100]
    });
  }

  // ── Whale Shockwave — expanding ring from a star ──────────────
  addShockwave(star, magnitude) {
    this.shockwaves.push({
      x: star.wx, y: star.wy,
      radius: 0,
      maxRadius: 200 + magnitude * 50,
      speed: 80 + magnitude * 20,
      alpha: 0.6,
      color: magnitude > 0 ? [0, 255, 200] : [255, 80, 100],
      startTime: Date.now()
    });
  }

  // ── Profit Particle Burst ─────────────────────────────────────
  addProfitBurst(star, isProfit) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      this.particles.push({
        x: star.wx, y: star.wy,
        vx: Math.cos(angle) * (2 + Math.random() * 3),
        vy: Math.sin(angle) * (2 + Math.random() * 3),
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        color: isProfit ? [0, 255, 200] : [255, 80, 100],
        size: 2 + Math.random() * 2
      });
    }
  }

  // ── Update & Draw ─────────────────────────────────────────────
  update(dt, W, H) {
    const ctx = this.ctx;
    const cam = this.cam;

    // Draw cascade pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.progress += p.speed * dt * 1000;
      
      if (p.progress >= 1) {
        this.pulses.splice(i, 1);
        continue;
      }
      
      const fx = (p.from.wx + (p.to.wx - p.from.wx) * p.progress - cam.x) * cam.z + W / 2;
      const fy = (p.from.wy + (p.to.wy - p.from.wy) * p.progress - cam.y) * cam.z + H / 2;
      const r = (4 + p.progress * 3) * cam.z;
      const a = 0.8 * (1 - p.progress);
      
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${a})`;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, 6.28);
      ctx.fill();
      
      // Trail
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${a * 0.3})`;
      ctx.beginPath();
      ctx.arc(fx, fy, r * 2.5, 0, 6.28);
      ctx.fill();
    }

    // Draw shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += s.speed * dt;
      s.alpha *= 0.97;
      
      if (s.alpha < 0.02 || s.radius > s.maxRadius) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      
      const sx = (s.x - cam.x) * cam.z + W / 2;
      const sy = (s.y - cam.y) * cam.z + H / 2;
      const sr = s.radius * cam.z;
      
      ctx.strokeStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${s.alpha})`;
      ctx.lineWidth = (2 + s.alpha * 3) * cam.z;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, 6.28);
      ctx.stroke();
    }

    // Draw particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.life -= p.decay;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      
      const px = (p.x - cam.x) * cam.z + W / 2;
      const py = (p.y - cam.y) * cam.z + H / 2;
      
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life})`;
      ctx.beginPath();
      ctx.arc(px, py, p.size * cam.z, 0, 6.28);
      ctx.fill();
    }
  }
}

// ── SENTIMENT GRAVITY — stars attract/repel based on correlation ─
function applySentimentGravity(stars, dt) {
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const a = stars[i], b = stars[j];
      if (a.type !== b.type) continue;
      
      const dx = b.wx - a.wx;
      const dy = b.wy - a.wy;
      const dist = Math.hypot(dx, dy);
      if (dist < 10 || dist > 600) continue;
      
      // Same direction = attract (correlated), opposite = repel
      const sameDir = a.dir === b.dir;
      const force = (a.warmth + b.warmth) * 0.15 * dt;
      
      if (sameDir) {
        // Attract — but not too close
        if (dist > 80) {
          a.wx += dx / dist * force;
          a.wy += dy / dist * force;
          b.wx -= dx / dist * force;
          b.wy -= dy / dist * force;
        }
      } else {
        // Repel
        if (dist < 300) {
          a.wx -= dx / dist * force * 0.5;
          a.wy -= dy / dist * force * 0.5;
          b.wx += dx / dist * force * 0.5;
          b.wy += dy / dist * force * 0.5;
        }
      }
    }
  }
}
