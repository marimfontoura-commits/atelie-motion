'use strict';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XML = 'http://www.w3.org/XML/1998/namespace';
const SVG_ELEMENTS = new Set((
  'svg g defs symbol use path rect circle ellipse line polyline polygon image title desc ' +
  'text tspan textPath linearGradient radialGradient stop pattern clipPath mask marker filter ' +
  'feBlend feColorMatrix feComponentTransfer feFuncR feFuncG feFuncB feFuncA feComposite ' +
  'feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood ' +
  'feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting ' +
  'feSpotLight feTile feTurbulence'
).split(' '));
const LOCAL_REF = /^#[a-zA-Z0-9_.:-]+$/;
const RASTER_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const W = 960;
const H = 600;
const stageNames = ['Entrada', 'Geral', 'Saída'];
const stageHints = ['Combine movimentos para revelar o objeto.', 'Combine movimentos que se completam antes da saída.', 'Combine movimentos para encerrar a animação.'];
const presets = [
  [['drift', '↑', 'Subir'], ['slide', '→', 'Deslizar'], ['zoom', '⊕', 'Ampliar'], ['fade', '◐', 'Aparecer'], ['bounce', '↟', 'Quicar'], ['spin', '⟳', 'Girar']],
  [['float', '↕', 'Flutuar'], ['sway', '↔', 'Balançar'], ['pulse', '⊙', 'Pulsar'], ['shimmer', '◐', 'Oscilar opacidade'], ['spin', '⟳', 'Girar']],
  [['drift', '↑', 'Subir'], ['slide', '→', 'Deslizar'], ['zoom', '⊖', 'Encolher'], ['fade', '◑', 'Desaparecer'], ['spin', '⟳', 'Girar']]
];
const phases = [
  {duration: .6, effects: new Set(['fade', 'zoom'])},
  {duration: 1.6, effects: new Set(['float'])},
  {duration: .5, effects: new Set(['fade'])}
];
const example = `<svg xmlns="${NS}" viewBox="0 0 300 300"><rect x="9" y="9" width="282" height="282" rx="73" fill="#c7b7ff"/><rect x="21" y="21" width="258" height="258" rx="62" fill="none" stroke="#e1d5ff" stroke-width="2"/><path d="M150 42c6 67 41 102 108 108-67 6-102 41-108 108-6-67-41-102-108-108 67-6 102-41 108-108Z" fill="#292042"/><circle cx="150" cy="150" r="17" fill="#dfedac"/></svg>`;
let asset = {src: 'data:image/svg+xml,' + encodeURIComponent(example), width: 300, height: 300, name: 'Objeto de exemplo', vector: vectorSource(new DOMParser().parseFromString(example, 'image/svg+xml').documentElement, [0, 0, 300, 300])};
let selected = 0;
let seconds = 0;
let playing = false;
let last = 0;
let frame = 0;
let uploadRequest = 0;
const total = () => phases.reduce((sum, phase) => sum + phase.duration, 0);
const fmt = v => Number(v.toFixed(6));
const basePose = () => ({x: 0, y: 0, scale: 1, angle: 0, opacity: 1});

function pose(index, u) {
  const effects = phases[index].effects;
  const result = basePose();
  const has = key => effects.has(key);
  if (index === 1) {
    const wave = Math.sin(u * Math.PI * 2);
    const swell = wave ** 2;
    if (has('float')) result.y -= 34 * swell;
    if (has('sway')) result.x += 38 * wave;
    if (has('pulse')) result.scale *= 1 + .14 * swell;
    if (has('shimmer')) result.opacity *= 1 - .48 * swell;
    if (has('spin')) result.angle += 360 * u;
    return result;
  }

  const amount = index === 0 ? (1 - u) ** 3 : u ** 3;
  const direction = index === 0 ? 1 : -1;
  if (has('drift')) result.y += direction * 115 * amount;
  if (has('slide')) result.x -= direction * 175 * amount;
  if (has('zoom')) result.scale *= 1 - .75 * amount;
  if (has('fade')) result.opacity *= 1 - amount;
  if (has('spin')) result.angle -= direction * 145 * amount;
  if (has('bounce')) result.scale *= 1 - (1 - u) ** 2 * Math.cos(3 * Math.PI * u) * .55;
  return result;
}

function currentPose(t) {
  for (const [index, phase] of phases.entries()) {
    if (phase.duration === 0) continue;
    if (t <= phase.duration + 1e-8) return pose(index, Math.min(1, t / phase.duration));
    t -= phase.duration;
  }
  return basePose();
}

function dimensions() {
  const scale = Number($('scale').value) / 100;
  const fit = Math.min(W / asset.width, H / asset.height) * scale;
  return {width: asset.width * fit, height: asset.height * fit};
}

function render() {
  const viewport = $('viewport');
  const stage = $('stage');
  const ratio = Math.max(0, Math.min((stage.clientWidth - 36) / W, (stage.clientHeight - 36) / H));
  viewport.style.width = W * ratio + 'px';
  viewport.style.height = H * ratio + 'px';
  const image = $('object');
  const {width, height} = dimensions();
  const p = currentPose(seconds);
  image.style.width = width * ratio + 'px';
  image.style.height = height * ratio + 'px';
  image.style.left = (W - width) / 2 * ratio + 'px';
  image.style.top = (H - height) / 2 * ratio + 'px';
  image.style.transform = `translate(${p.x * ratio}px,${p.y * ratio}px) rotate(${p.angle}deg) scale(${p.scale})`;
  image.style.opacity = p.opacity;
  $('seek').max = total();
  $('seek').value = seconds;
  $('time').textContent = `${seconds.toFixed(2)} / ${total().toFixed(2)} s`;
}

function changePlayback(active) {
  playing = active;
  $('play').textContent = active ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', active ? 'Pausar' : 'Reproduzir');
  cancelAnimationFrame(frame);
  if (active) {
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

function tick(now) {
  seconds += (now - last) / 1000;
  last = now;
  const end = total();
  if (seconds >= end) {
    if ($('loop').checked && end > 0) seconds %= end;
    else {
      seconds = end;
      changePlayback(false);
    }
  }
  render();
  if (playing) frame = requestAnimationFrame(tick);
}

function showSettings() {
  document.querySelectorAll('[data-stage]').forEach(button => {
    button.setAttribute('aria-pressed', Number(button.dataset.stage) === selected);
  });
  $('hint').textContent = stageHints[selected];
  $('duration').value = phases[selected].duration;
  $('presets').replaceChildren(...presets[selected].map(([key, glyph, label]) => {
    const button = document.createElement('button');
    button.className = 'preset';
    const icon = document.createElement('span');
    icon.textContent = glyph;
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon, label);
    button.setAttribute('aria-pressed', phases[selected].effects.has(key));
    button.onclick = () => {
      const effects = phases[selected].effects;
      if (effects.has(key)) effects.delete(key);
      else effects.add(key);
      button.setAttribute('aria-pressed', effects.has(key));
      const start = phases.slice(0, selected).reduce((sum, p) => sum + p.duration, 0);
      seconds = start + phases[selected].duration * .22;
      if (!playing && !$('loop').checked) render();
      else startPlayback();
      refreshTrack();
    };
    return button;
  }));
  refreshTrack();
}

function refreshTrack() {
  $('track').replaceChildren(...phases.map((phase, index) => {
    const button = document.createElement('button');
    button.textContent = stageNames[index] + ' · ' + phase.duration.toFixed(2) + ' s';
    button.style.flex = Math.max(.25, phase.duration);
    button.classList.toggle('active', selected === index);
    button.onclick = () => {
      selected = index;
      changePlayback(false);
      seconds = phases.slice(0, index).reduce((sum, p) => sum + p.duration, 0);
      showSettings();
      render();
    };
    return button;
  }));
}

function startPlayback() {
  if (!total()) return;
  if (seconds >= total()) seconds = 0;
  changePlayback(true);
}

function status(message) {
  $('status').textContent = message;
  $('status').hidden = !message;
}

function readUrl(file, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.replace(/^data:[^;]*;/, 'data:' + type + ';'));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function vectorSource(root, viewBox) {
  // Keep SVGs that need active content, external links or stylesheets in image mode.
  const nodes = [root, ...root.querySelectorAll('*')];
  for (const node of nodes) {
    if (node.namespaceURI !== NS || !SVG_ELEMENTS.has(node.localName)) return null;
    for (const attr of node.attributes) {
      const {namespaceURI, localName, value} = attr;
      if (namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      if (namespaceURI === XML && (localName === 'space' || localName === 'lang')) continue;
      if (localName === 'href' && (!namespaceURI || namespaceURI === XLINK)) {
        if (!LOCAL_REF.test(value) && !(node.localName === 'image' && RASTER_DATA.test(value))) return null;
        continue;
      }
      if (namespaceURI || /^on/i.test(localName) || /[\\]|\/\*/.test(value)) return null;
      const remaining = value.replace(/url\(\s*(['"]?)(#[a-zA-Z0-9_.:-]+)\1\s*\)/gi, '');
      if (/url\s*\(/i.test(remaining)) return null;
      if (localName === 'style' && /[{}@]|(?:image-set|image|src)\s*\(/i.test(remaining)) return null;
    }
  }

  const copy = root.cloneNode(true);
  const ids = new Map([...copy.querySelectorAll('[id]')].map(node => [node.id, node]));
  for (const use of copy.querySelectorAll('use')) {
    const ref = use.getAttribute('href') ?? use.getAttributeNS(XLINK, 'href');
    const target = ref && ids.get(ref.slice(1));
    const isSimplePath = target?.localName === 'path' && target.attributes.length === 2 && target.hasAttribute('d');
    const hasOffset = ['x', 'y', 'width', 'height'].some(name => use.hasAttribute(name));
    if (!isSimplePath || hasOffset) continue;
    // Figma can import the actual path directly, including when it is used by a mask.
    const path = use.ownerDocument.createElementNS(NS, 'path');
    for (const attr of use.attributes) {
      if (attr.localName !== 'href') path.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    path.setAttribute('d', target.getAttribute('d'));
    use.replaceWith(path);
  }
  // Do not serialize processing instructions or a doctype into the exported SVG.
  const group = copy.ownerDocument.createElementNS(NS, 'g');
  const viewportAttributes = new Set(['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'version', 'overflow']);
  for (const attr of copy.attributes) {
    if (attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !viewportAttributes.has(attr.name)) {
      group.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
  }
  const instructions = copy.ownerDocument.createTreeWalker(copy, NodeFilter.SHOW_PROCESSING_INSTRUCTION);
  const remove = [];
  while (instructions.nextNode()) remove.push(instructions.currentNode);
  remove.forEach(node => node.remove());
  group.append(...copy.childNodes);
  return {markup: new XMLSerializer().serializeToString(group), viewBox};
}

async function importAsset(file) {
  if (!file) return;
  const request = ++uploadRequest;
  const originalName = file.name;
  const extension = file.name.split('.').pop().toLowerCase();
  const type = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml'}[extension];
  if (!type) return status('Escolha um arquivo PNG, JPEG ou SVG.');
  status('Carregando imagem…');
  try {
    let viewBox;
    let svgRoot;
    if (extension === 'svg') {
      const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
      const root = doc.documentElement;
      if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('SVG inválido');
      const values = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) viewBox = values;
      if (root.namespaceURI !== NS) {
        const normalized = root.outerHTML.replace(/^<svg(?=[\s>])/, `<svg xmlns="${NS}"`);
        file = new Blob([normalized], {type});
        svgRoot = new DOMParser().parseFromString(normalized, 'image/svg+xml').documentElement;
      } else {
        svgRoot = root;
      }
    }
    const src = await readUrl(file, type);
    const probe = new Image();
    probe.src = src;
    await probe.decode();
    if (request !== uploadRequest) return;
    const width = viewBox?.[2] || probe.naturalWidth;
    const height = viewBox?.[3] || probe.naturalHeight;
    if (!width || !height) throw Error('Dimensões inválidas');
    const vector = svgRoot ? vectorSource(svgRoot, viewBox ?? [0, 0, width, height]) : null;
    asset = {src, width, height, name: originalName, vector, vectorFallback: Boolean(svgRoot && !vector)};
    $('object').src = src;
    $('filename').textContent = asset.name;
    $('filename').title = asset.name;
    status(asset.vectorFallback ? vectorFallbackNotice : '');
    seconds = 0;
    render();
    startPlayback();
  } catch {
    if (request === uploadRequest) status('Não foi possível abrir a imagem. Confira o arquivo e tente novamente.');
  }
}

const vectorFallbackNotice = 'Este SVG será incorporado como imagem para preservar a aparência. O Figma pode não importar a arte como vetor.';

function artwork(width, height) {
  if (asset.vector) {
    const {markup, viewBox: [x, y, w, h]} = asset.vector;
    return `<g transform="translate(${fmt(-width / 2)} ${fmt(-height / 2)}) scale(${fmt(width / w)} ${fmt(height / h)}) translate(${-x} ${-y})">${markup}</g>`;
  }
  return `<image x="${fmt(-width / 2)}" y="${fmt(-height / 2)}" width="${fmt(width)}" height="${fmt(height)}" href="${asset.src}" xlink:href="${asset.src}"/>`;
}

function svgFile() {
  const duration = total();
  const {width, height} = dimensions();
  const positions = [];
  const times = [];
  let elapsed = 0;
  phases.forEach((phase, index) => {
    if (!phase.duration) return;
    const steps = Math.max(12, Math.ceil(phase.duration * 48));
    for (let step = positions.length ? 1 : 0; step <= steps; step++) {
      const progress = step / steps;
      const sample = pose(index, progress);
      // Full turns are equivalent to zero at a stage boundary. Unwrap to avoid reversing at the next sample.
      if (positions.length) sample.angle += Math.round((positions.at(-1).angle - sample.angle) / 360) * 360;
      positions.push(sample);
      times.push(step === steps && Math.abs(elapsed + phase.duration - duration) < 1e-8 ? 1 : fmt((elapsed + progress * phase.duration) / duration));
    }
    elapsed += phase.duration;
  });
  const timing = `dur="${fmt(duration)}s" keyTimes="${times.join(';')}" calcMode="linear" repeatCount="${$('loop').checked ? 'indefinite' : '1'}" fill="freeze"`;
  const animation = (type, map) => positions.length
    ? `<animateTransform attributeName="transform" type="${type}" ${timing} values="${positions.map(map).join(';')}"/>`
    : '';
  const opacity = positions.length ? `<animate attributeName="opacity" ${timing} values="${positions.map(p => fmt(p.opacity)).join(';')}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="hidden"><g transform="translate(${W / 2} ${H / 2})"><g transform="translate(0 0)">${animation('translate', p => `${fmt(p.x)} ${fmt(p.y)}`)}<g transform="rotate(0)">${animation('rotate', p => fmt(p.angle))}<g transform="scale(1)">${animation('scale', p => fmt(p.scale))}<g opacity="1">${opacity}${artwork(width, height)}</g></g></g></g></g></svg>`;
}

function download() {
  if (!phases.some(phase => phase.duration > 0 && phase.effects.size)) {
    return status('Ative um preset em uma etapa com duração maior que zero para exportar.');
  }
  status(asset.vectorFallback ? vectorFallbackNotice : '');
  const blob = new Blob([svgFile()], {type: 'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = asset.name.replace(/\.[^.]+$/, '') + '-animado.svg';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

document.querySelectorAll('[data-stage]').forEach(button => button.onclick = () => {
  selected = Number(button.dataset.stage);
  showSettings();
});
$('duration').onchange = event => {
  phases[selected].duration = Math.round(Math.min(20, Math.max(0, Number(event.target.value) || 0)) * 100) / 100;
  seconds = Math.min(seconds, total());
  showSettings();
  render();
};
$('scale').oninput = event => {
  $('scaleValue').textContent = event.target.value + '%';
  render();
};
$('play').onclick = () => playing ? changePlayback(false) : startPlayback();
$('seek').oninput = event => {
  changePlayback(false);
  seconds = Number(event.target.value);
  render();
};
$('export').onclick = download;
$('drop').onkeydown = event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('file').click();
  }
};
$('file').onchange = event => {
  const file = event.target.files[0];
  importAsset(file);
  event.target.value = '';
};
$('drop').ondragover = event => {
  event.preventDefault();
  $('drop').classList.add('drag');
};
$('drop').ondragleave = () => $('drop').classList.remove('drag');
$('drop').ondrop = event => {
  event.preventDefault();
  $('drop').classList.remove('drag');
  importAsset(event.dataTransfer.files[0]);
};
$('object').src = asset.src;
$('size').textContent = W + ' × ' + H + ' px';
showSettings();
new ResizeObserver(render).observe($('stage'));
render();
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) startPlayback();
