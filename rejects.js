(() => {
  const page = document.querySelector('.rejects-page');
  if (!page) return;

  const bin = page.querySelector('.rejects-bin');
  const binContents = page.querySelector('.bin-contents');
  const collage = page.querySelector('[data-crumple-source]');
  const slots = [
    { x: 0.38, y: 0.52, rotation: -12 },
    { x: 0.62, y: 0.58, rotation: 9 },
    { x: 0.38, y: 0.66, rotation: 14 },
    { x: 0.62, y: 0.64, rotation: -7 }
  ];
  let drag = null;
  let topLayer = 10;
  let resizeTimer = 0;

  const cancelMotion = (ball) => {
    ball.getAnimations().forEach((animation) => animation.cancel());
    if (ball.motionFrame) cancelAnimationFrame(ball.motionFrame);
    ball.motionFrame = 0;
    delete ball.dataset.motion;
  };

  const releaseSlot = (ball) => {
    if (ball.parentElement === binContents) {
      const pageBounds = page.getBoundingClientRect();
      const bounds = ball.getBoundingClientRect();
      page.appendChild(ball);
      ball.style.left = `${bounds.left - pageBounds.left}px`;
      ball.style.top = `${bounds.top - pageBounds.top}px`;
    }
    ball.classList.remove('is-binned');
    ball.removeAttribute('data-in-bin');
    delete ball.dataset.slot;
    ball.setAttribute('aria-label', 'Crumpled paper. Drag it to the bin or throw it off screen.');
  };

  const animateTo = (ball, left, top, rotation, duration = 180, after, startLeft, startTop) => {
    const currentLeft = startLeft ?? (Number.parseFloat(ball.style.left) || ball.offsetLeft);
    const currentTop = startTop ?? (Number.parseFloat(ball.style.top) || ball.offsetTop);
    const currentRotation = Number.parseFloat(ball.dataset.rotation) || 0;
    const animation = ball.animate([
      { left: `${currentLeft}px`, top: `${currentTop}px`, transform: `rotate(${currentRotation}deg)` },
      { left: `${left}px`, top: `${top}px`, transform: `rotate(${rotation}deg)` }
    ], { duration, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' });
    ball.style.left = `${left}px`;
    ball.style.top = `${top}px`;
    ball.style.transform = `rotate(${rotation}deg)`;
    ball.dataset.rotation = String(rotation);
    if (after) animation.addEventListener('finish', after, { once: true });
  };

  const placeInBin = (ball, velocityX = 0, velocityY = 0, useSlot = false) => {
    if (ball.dataset.discarded) return;
    cancelMotion(ball);
    let slotIndex = Number.parseInt(ball.dataset.slot, 10);
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) {
      const occupied = new Set(Array.from(page.querySelectorAll('[data-slot]'), (item) => Number(item.dataset.slot)));
      slotIndex = slots.findIndex((slot, index) => !occupied.has(index));
    }
    if (slotIndex < 0) return;
    const slot = slots[slotIndex];
    const binBounds = bin.getBoundingClientRect();
    const currentBounds = ball.getBoundingClientRect();
    const left = useSlot
      ? binBounds.width * slot.x - currentBounds.width / 2
      : ball.parentElement === binContents ? ball.offsetLeft : currentBounds.left - binBounds.left;
    const top = useSlot
      ? binBounds.height * slot.y - currentBounds.height / 2
      : ball.parentElement === binContents ? ball.offsetTop : currentBounds.top - binBounds.top;
    binContents.appendChild(ball);
    ball.style.left = `${left}px`;
    ball.style.top = `${top}px`;
    if (useSlot) {
      ball.style.transform = `rotate(${slot.rotation}deg)`;
      ball.dataset.rotation = String(slot.rotation);
    }
    ball.dataset.slot = String(slotIndex);
    ball.dataset.inBin = 'true';
    ball.classList.add('is-binned');
    ball.style.zIndex = '';
    ball.setAttribute('aria-label', 'Crumpled paper in the bin. Drag it out or press Enter to take it out.');
    if (!useSlot) startMotion(ball, velocityX, velocityY, false);
  };

  const pathHitsBinOpening = (ball, fromLeft, fromTop, toLeft, toTop) => {
    const pageBounds = page.getBoundingClientRect();
    const binBounds = bin.getBoundingClientRect();
    const openingX = binBounds.left + binBounds.width * 0.5;
    const openingY = binBounds.top + binBounds.height * 0.12;
    const radiusX = binBounds.width * 0.42;
    const radiusY = binBounds.height * 0.13;
    for (let step = 1; step <= 6; step += 1) {
      const progress = step / 6;
      const centerX = pageBounds.left + fromLeft + (toLeft - fromLeft) * progress + ball.offsetWidth / 2;
      const centerY = pageBounds.top + fromTop + (toTop - fromTop) * progress + ball.offsetHeight / 2;
      const normalizedX = (centerX - openingX) / radiusX;
      const normalizedY = (centerY - openingY) / radiusY;
      if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) return true;
    }
    return false;
  };

  const startMotion = (ball, velocityX, velocityY, offscreen) => {
    cancelMotion(ball);
    const speed = Math.hypot(velocityX, velocityY);
    const cap = offscreen ? 2.1 : 1.35;
    const scale = speed > cap ? cap / speed : 1;
    let vx = velocityX * scale;
    let vy = velocityY * scale;
    if (offscreen && speed < 0.75) {
      const minimum = Math.max(0.001, speed);
      vx = velocityX / minimum * 0.75;
      vy = velocityY / minimum * 0.75;
    }
    let left = Number.parseFloat(ball.style.left) || ball.offsetLeft;
    let top = Number.parseFloat(ball.style.top) || ball.offsetTop;
    let rotation = Number.parseFloat(ball.dataset.rotation) || 0;
    let previous = performance.now();
    let elapsed = 0;
    let landed = false;
    ball.dataset.motion = offscreen ? 'throw' : 'free';
    const frame = (now) => {
      const delta = Math.min(32, now - previous);
      previous = now;
      elapsed += delta;
      const damping = Math.pow(offscreen ? 0.992 : 0.90, delta / 16.67);
      vx *= damping;
      vy += 0.0016 * delta;
      const fromLeft = left;
      const fromTop = top;
      left += vx * delta;
      top += vy * delta;
      rotation += vx * delta * 0.08;
      const insideBin = ball.parentElement === binContents;
      const floor = insideBin
        ? bin.clientHeight - ball.offsetHeight - 4
        : bin.offsetTop + bin.offsetHeight - ball.offsetHeight - 4;
      if (!offscreen && top >= floor) {
        top = floor;
        vy = -Math.abs(vy) * 0.18;
        vx *= 0.55;
        landed = true;
        if (Math.abs(vy) < 0.08) vy = 0;
      }
      ball.style.left = `${left}px`;
      ball.style.top = `${top}px`;
      ball.style.transform = `rotate(${rotation}deg)`;
      ball.dataset.rotation = String(rotation);
      if (!offscreen && !insideBin && pathHitsBinOpening(ball, fromLeft, fromTop, left, top)) {
        placeInBin(ball, vx, vy);
        return;
      }
      const outside = left + ball.offsetWidth < 0 || left > window.innerWidth;
      if (outside) {
        if (offscreen || elapsed > 1800) {
          ball.dataset.discarded = 'outside';
          ball.hidden = true;
          delete ball.dataset.motion;
          ball.motionFrame = 0;
          return;
        }
        throwOffscreen(ball, vx, vy);
        return;
      }
      const settled = landed && Math.abs(vx) < 0.035 && Math.abs(vy) < 0.035;
      if (settled || (!offscreen && elapsed > 2500)) {
        delete ball.dataset.motion;
        ball.motionFrame = 0;
        return;
      }
      ball.motionFrame = requestAnimationFrame(frame);
    };
    ball.motionFrame = requestAnimationFrame(frame);
  };

  const throwOffscreen = (ball, velocityX, velocityY) => {
    if (!ball || ball.dataset.discarded) return;
    releaseSlot(ball);
    ball.dataset.discarded = 'throwing';
    ball.style.zIndex = String(++topLayer);
    ball.setAttribute('aria-hidden', 'true');
    ball.tabIndex = -1;
    const pageBounds = page.getBoundingClientRect();
    const bounds = ball.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    if (Math.hypot(velocityX, velocityY) < 0.1) {
      const distances = [
        { x: -1, y: 0, value: Math.abs(centerX - pageBounds.left) },
        { x: 1, y: 0, value: Math.abs(pageBounds.right - centerX) }
      ].sort((a, b) => a.value - b.value);
      velocityX = distances[0].x;
      velocityY = distances[0].y;
    }
    startMotion(ball, velocityX, velocityY, true);
  };

  page.addEventListener('pointerdown', (event) => {
    const ball = event.target.closest('[data-paper-ball]');
    if (!ball || !page.contains(ball) || event.button !== 0 || ball.dataset.discarded) return;
    event.preventDefault();
    cancelMotion(ball);
    const pageBounds = page.getBoundingClientRect();
    const bounds = ball.getBoundingClientRect();
    const wasBinned = ball.hasAttribute('data-in-bin');
    releaseSlot(ball);
    ball.style.left = `${bounds.left - pageBounds.left}px`;
    ball.style.top = `${bounds.top - pageBounds.top}px`;
    ball.style.zIndex = String(++topLayer);
    ball.classList.add('is-dragging');
    drag = {
      ball,
      pointerId: event.pointerId,
      pageBounds,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
      moved: false,
      wasBinned
    };
    ball.setPointerCapture(event.pointerId);
  });

  page.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime);
    const velocityX = (event.clientX - drag.lastX) / elapsed;
    const velocityY = (event.clientY - drag.lastY) / elapsed;
    drag.velocityX = drag.velocityX * 0.65 + velocityX * 0.35;
    drag.velocityY = drag.velocityY * 0.65 + velocityY * 0.35;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 1) drag.moved = true;
    drag.ball.style.left = `${event.clientX - drag.pageBounds.left - drag.offsetX}px`;
    drag.ball.style.top = `${event.clientY - drag.pageBounds.top - drag.offsetY}px`;
  });

  const finishDrag = (event, cancelled = false) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    const ball = current.ball;
    ball.classList.remove('is-dragging');
    if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
    if (cancelled || !current.moved) {
      if (current.wasBinned) placeInBin(ball);
      return;
    }
    const binBounds = bin.getBoundingClientRect();
    const bounds = ball.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const insideBin = centerX >= binBounds.left && centerX <= binBounds.right && centerY >= binBounds.top && centerY <= binBounds.bottom;
    const pageBounds = page.getBoundingClientRect();
    const outsideHorizontal = centerX < pageBounds.left || centerX > pageBounds.right;
    const speed = Math.hypot(current.velocityX, current.velocityY);
    const edgeRange = Math.min(260, window.innerWidth * 0.18);
    const movingOutward =
      (current.velocityX < 0 && centerX - pageBounds.left < edgeRange) ||
      (current.velocityX > 0 && pageBounds.right - centerX < edgeRange);
    if (insideBin) {
      placeInBin(ball, current.velocityX, current.velocityY);
    } else if (outsideHorizontal || (speed > 1.25 && movingOutward)) {
      throwOffscreen(ball, current.velocityX, current.velocityY);
    } else {
      startMotion(ball, current.velocityX, current.velocityY, false);
    }
  };

  page.addEventListener('pointerup', (event) => finishDrag(event));
  page.addEventListener('pointercancel', (event) => finishDrag(event, true));

  page.addEventListener('keydown', (event) => {
    const ball = event.target.closest('[data-paper-ball]');
    if (!ball || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    if (ball.hasAttribute('data-in-bin')) {
      const pageBounds = page.getBoundingClientRect();
      const binBounds = bin.getBoundingClientRect();
      const bounds = ball.getBoundingClientRect();
      releaseSlot(ball);
      ball.style.zIndex = String(++topLayer);
      animateTo(ball, binBounds.left - pageBounds.left - bounds.width - 12, binBounds.top - pageBounds.top + binBounds.height - bounds.height, -10);
    } else {
      placeInBin(ball, 0, 0, true);
    }
  });

  collage.addEventListener('click', () => {
    if (collage.dataset.crumpled) return;
    collage.dataset.crumpled = 'true';
    const template = page.querySelector('[data-paper-ball]');
    const pageBounds = page.getBoundingClientRect();
    const sheetBounds = collage.getBoundingClientRect();
    const templateBounds = template.getBoundingClientRect();
    const ball = template.cloneNode(true);
    ball.dataset.paperBall = 'sheet';
    ball.hidden = false;
    ball.tabIndex = 0;
    ball.classList.remove('is-binned', 'is-dragging');
    ball.removeAttribute('data-in-bin');
    ball.removeAttribute('data-discarded');
    ball.removeAttribute('aria-hidden');
    ball.setAttribute('aria-label', 'Crumpled rejected sheet. Drag it to the bin or throw it off screen.');
    delete ball.dataset.slot;
    ball.style.left = `${sheetBounds.left - pageBounds.left + sheetBounds.width / 2 - templateBounds.width / 2}px`;
    ball.style.top = `${sheetBounds.top - pageBounds.top + sheetBounds.height / 2 - templateBounds.height / 2}px`;
    ball.style.zIndex = String(++topLayer);
    ball.style.visibility = 'visible';
    ball.style.opacity = '1';
    ball.style.transform = 'scale(0.25) rotate(-15deg)';
    ball.querySelector('img').alt = '';
    page.appendChild(ball);
    const sheetAnimation = collage.animate([
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'scale(0.08) rotate(-12deg)', opacity: 0 }
    ], { duration: 280, easing: 'cubic-bezier(0.4, 0, 0.7, 0.2)' });
    sheetAnimation.addEventListener('finish', () => { collage.hidden = true; }, { once: true });
    ball.animate([
      { transform: 'scale(0.25) rotate(-15deg)', opacity: 0 },
      { transform: 'scale(1) rotate(0deg)', opacity: 1 }
    ], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
    ball.style.transform = 'rotate(0deg)';
    ball.dataset.rotation = '0';
  });

  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!drag) page.querySelectorAll('.is-binned').forEach((ball) => placeInBin(ball, 0));
    }, 100);
  });
})();
