/* ==========================================================================
   MEMORY MAPS — Psychogeographic Route Mapper
   ========================================================================== */

(function () {
  'use strict';

  // ========================================================================
  // Configuration
  // ========================================================================

  const CONFIG = {
    center: [42.8746, 74.5698], // Bishkek
    zoom: 13,
    repoOwner: 'memory-maps',
    repoName: 'memory-maps.github.io',
    dataPath: 'data/routes.json',
    tokenKey: 'memory_maps_token',
  };

  const API_BASE = `https://api.github.com/repos/${CONFIG.repoOwner}/${CONFIG.repoName}`;

  // Luminous / spectral palette for route colors
  const PALETTE = [
    '#ff6b6b', // Ruby light
    '#4ecdc4', // Spectral teal
    '#ffe66d', // Amber glow
    '#a29bfe', // Lavender haze
    '#fd79a8', // Rose quartz
    '#74b9ff', // Cerulean
    '#55efc4', // Emerald
    '#e17055', // Burnt sienna
    '#00cec9', // Cyan
    '#fab1a0', // Pale coral
  ];

  // ========================================================================
  // Roman Numeral Conversion
  // ========================================================================

  function toRoman(num) {
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let result = '';
    for (let i = 0; i < vals.length; i++) {
      while (num >= vals[i]) {
        result += syms[i];
        num -= vals[i];
      }
    }
    return result;
  }

  // ========================================================================
  // State
  // ========================================================================

  let map;
  let routes = [];
  let routeLayers = {};
  let githubToken = null;
  let isAuthenticated = false;
  let isDrawing = false;
  let isSaving = false;
  let currentDrawing = {
    points: [],
    polyline: null,
    markers: [],
  };
  let panelOpen = true;
  let selectedRouteId = null;

  // ========================================================================
  // DOM References
  // ========================================================================

  const $ = (sel) => document.querySelector(sel);

  const dom = {
    map: $('#map'),
    panel: $('#panel'),
    routeList: $('#route-list'),
    routeCount: $('#route-count'),
    btnTogglePanel: $('#btn-toggle-panel'),
    btnAuth: $('#btn-auth'),
    btnNewRoute: $('#btn-new-route'),
    authModal: $('#auth-modal'),
    authInput: $('#auth-input'),
    authError: $('#auth-error'),
    btnAuthSubmit: $('#btn-auth-submit'),
    btnAuthCancel: $('#btn-auth-cancel'),
    routePanel: $('#route-panel'),
    routeTitle: $('#route-title'),
    routeDate: $('#route-date'),
    routeNotes: $('#route-notes'),
    pointCount: $('#point-count'),
    routeDistance: $('#route-distance'),
    btnRouteSave: $('#btn-route-save'),
    btnRouteCancel: $('#btn-route-cancel'),
    btnRouteUndo: $('#btn-route-undo'),
    detailModal: $('#detail-modal'),
    detailNumber: $('#detail-number'),
    detailTitle: $('#detail-title'),
    detailDate: $('#detail-date'),
    detailDistance: $('#detail-distance'),
    detailNotes: $('#detail-notes'),
    btnDetailClose: $('#btn-detail-close'),
    btnDetailFocus: $('#btn-detail-focus'),
    btnDetailDelete: $('#btn-detail-delete'),
    drawIndicator: $('#draw-indicator'),
    btnExport: $('#btn-export'),
    btnImport: $('#btn-import'),
    importFile: $('#import-file'),
  };

  // ========================================================================
  // Utilities
  // ========================================================================

  function uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  }

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function totalDistance(points) {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += haversineDistance(
        points[i - 1][0], points[i - 1][1],
        points[i][0], points[i][1]
      );
    }
    return dist;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function getColor(index) {
    return PALETTE[index % PALETTE.length];
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ========================================================================
  // Esoteric SVG Markers
  // ========================================================================

  function makeThirdEyeSVG(color) {
    // Concentric circles with radiating lines — origin point of the drift
    return `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="9" fill="none" stroke="${color}" stroke-width="1" opacity="0.4"/>
      <circle cx="11" cy="11" r="5" fill="none" stroke="${color}" stroke-width="1" opacity="0.7"/>
      <circle cx="11" cy="11" r="2" fill="${color}"/>
      <line x1="11" y1="0" x2="11" y2="4" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
      <line x1="11" y1="18" x2="11" y2="22" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
      <line x1="0" y1="11" x2="4" y2="11" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
      <line x1="18" y1="11" x2="22" y2="11" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
    </svg>`;
  }

  function makeSpiralSVG(color) {
    // Spiral symbol — the vortex / destination
    return `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 11 C11 9, 13 7, 15 9 C17 11, 15 15, 11 15 C7 15, 5 11, 7 7 C9 3, 15 3, 17 7 C19 11, 17 17, 11 19 C5 19, 3 13, 3 11"
        fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="11" cy="11" r="1.5" fill="${color}"/>
    </svg>`;
  }

  // ========================================================================
  // GitHub API — Storage
  // ========================================================================

  // Fetch routes from the public site (no auth needed)
  async function fetchRoutesFromSite() {
    try {
      const resp = await fetch(`/${CONFIG.dataPath}?_=${Date.now()}`);
      if (!resp.ok) return [];
      return await resp.json();
    } catch {
      return [];
    }
  }

  // Get file SHA from GitHub API (needed for updates)
  async function getFileSha() {
    const resp = await fetch(`${API_BASE}/contents/${CONFIG.dataPath}`, {
      headers: { Authorization: `Bearer ${githubToken}` },
    });
    if (!resp.ok) throw new Error('Could not read file from GitHub');
    const data = await resp.json();
    return data.sha;
  }

  // Commit updated routes to the repo
  async function commitRoutes(routes, message) {
    const sha = await getFileSha();
    const content = toBase64(JSON.stringify(routes, null, 2) + '\n');

    const resp = await fetch(`${API_BASE}/contents/${CONFIG.dataPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, content, sha }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to save to GitHub');
    }
    return true;
  }

  // ========================================================================
  // Auth — GitHub Token
  // ========================================================================

  function loadToken() {
    githubToken = sessionStorage.getItem(CONFIG.tokenKey);
    isAuthenticated = !!githubToken;
    updateAuthUI();
  }

  function updateAuthUI() {
    if (isAuthenticated) {
      dom.btnAuth.textContent = 'DISSOLVE';
      dom.btnNewRoute.classList.remove('hidden');
    } else {
      dom.btnAuth.textContent = 'INITIATE';
      dom.btnNewRoute.classList.add('hidden');
    }
    dom.btnDetailDelete.classList.toggle('hidden', !isAuthenticated);
  }

  async function authenticate(token) {
    if (!token || !token.trim()) return false;
    token = token.trim();

    // Validate: try to read the data file from the repo
    try {
      const resp = await fetch(`${API_BASE}/contents/${CONFIG.dataPath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return false;

      githubToken = token;
      isAuthenticated = true;
      sessionStorage.setItem(CONFIG.tokenKey, token);
      updateAuthUI();
      hideModal(dom.authModal);
      return true;
    } catch {
      return false;
    }
  }

  function logout() {
    githubToken = null;
    isAuthenticated = false;
    sessionStorage.removeItem(CONFIG.tokenKey);
    updateAuthUI();
    cancelDrawing();
  }

  // ========================================================================
  // Map
  // ========================================================================

  function initMap() {
    map = L.map('map', {
      center: CONFIG.center,
      zoom: CONFIG.zoom,
      zoomControl: false,
      attributionControl: true,
    });

    // CartoDB Dark Matter — dark, atmospheric map tiles
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    ).addTo(map);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    map.on('click', onMapClick);
    map.on('dblclick', onMapDoubleClick);
  }

  // ========================================================================
  // Route Rendering
  // ========================================================================

  function renderRoutes() {
    Object.values(routeLayers).forEach((layer) => map.removeLayer(layer));
    routeLayers = {};

    routes.forEach((route, index) => {
      if (route.coordinates && route.coordinates.length > 1) {
        const color = route.color || getColor(index);
        const polyline = L.polyline(route.coordinates, {
          color: color,
          weight: 3,
          opacity: 0.8,
          smoothFactor: 1.5,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);

        // Start marker: Third Eye — origin point of the drift
        const goldColor = '#c9a84c';
        const startIcon = L.divIcon({
          className: '',
          html: makeThirdEyeSVG(goldColor),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const startMarker = L.marker(route.coordinates[0], { icon: startIcon }).addTo(map);

        // End marker: Spiral — the vortex / destination
        const endIcon = L.divIcon({
          className: '',
          html: makeSpiralSVG(goldColor),
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const endMarker = L.marker(
          route.coordinates[route.coordinates.length - 1],
          { icon: endIcon }
        ).addTo(map);

        polyline.on('mouseover', function () {
          this.setStyle({ weight: 5, opacity: 1 });
        });
        polyline.on('mouseout', function () {
          if (selectedRouteId !== route.id) {
            this.setStyle({ weight: 3, opacity: 0.8 });
          }
        });
        polyline.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          showRouteDetail(route.id);
        });

        routeLayers[route.id] = L.layerGroup([polyline, startMarker, endMarker]).addTo(map);
      }
    });
  }

  // ========================================================================
  // Panel / Route List
  // ========================================================================

  function renderRouteList() {
    const list = dom.routeList;
    dom.routeCount.textContent = `${routes.length} D\u00c9RIVE${routes.length !== 1 ? 'S' : ''}`;

    if (routes.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&mdash;</div>
          <p>&ldquo;In a d&eacute;rive one or more persons during a certain period drop their relations, their work and leisure activities, and let themselves be drawn by the attractions of the terrain and the encounters they find there.&rdquo;<br><br>&mdash; Guy Debord</p>
        </div>
      `;
      return;
    }

    list.innerHTML = routes
      .map((route, index) => {
        const dist = route.distance ? route.distance.toFixed(1) : '0.0';
        const color = route.color || getColor(index);
        return `
          <div class="route-card" data-id="${route.id}">
            <div class="route-color-bar" style="background:${color};color:${color}"></div>
            <div class="route-number">${toRoman(index + 1)}</div>
            <div class="route-info">
              <div class="route-card-title">${escapeHtml(route.name)}</div>
              <div class="route-card-meta">${formatDate(route.date)} &middot; ${dist} km</div>
            </div>
          </div>
        `;
      })
      .join('');

    list.querySelectorAll('.route-card').forEach((card) => {
      card.addEventListener('click', () => showRouteDetail(card.dataset.id));
    });
  }

  // ========================================================================
  // Drawing
  // ========================================================================

  function startDrawing() {
    isDrawing = true;
    currentDrawing = { points: [], polyline: null, markers: [] };
    dom.drawIndicator.classList.remove('hidden');
    dom.routeDate.value = new Date().toISOString().split('T')[0];
    dom.routeTitle.value = '';
    dom.routeNotes.value = '';
    dom.pointCount.textContent = '0';
    dom.routeDistance.textContent = '0.0';
    dom.btnRouteSave.textContent = 'INSCRIBE';
    dom.btnRouteSave.disabled = false;
    dom.routePanel.classList.remove('hidden');
    map.getContainer().style.cursor = 'crosshair';

    if (window.innerWidth <= 768) {
      dom.panel.classList.add('collapsed');
      panelOpen = false;
    }
  }

  function onMapClick(e) {
    if (!isDrawing) return;

    const latlng = [e.latlng.lat, e.latlng.lng];
    currentDrawing.points.push(latlng);

    // Gold drawing markers
    const goldColor = '#c9a84c';
    const markerIcon = L.divIcon({
      className: '',
      html: `<div style="width:8px;height:8px;background:${goldColor};border:2px solid rgba(201,168,76,0.3);border-radius:50%;box-shadow:0 0 6px rgba(201,168,76,0.4)"></div>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4],
    });
    const marker = L.marker(latlng, { icon: markerIcon }).addTo(map);
    currentDrawing.markers.push(marker);

    if (currentDrawing.polyline) {
      currentDrawing.polyline.setLatLngs(currentDrawing.points);
    } else if (currentDrawing.points.length > 1) {
      currentDrawing.polyline = L.polyline(currentDrawing.points, {
        color: goldColor,
        weight: 3,
        opacity: 0.8,
        dashArray: '8 4',
      }).addTo(map);
    }

    dom.pointCount.textContent = currentDrawing.points.length;
    dom.routeDistance.textContent = totalDistance(currentDrawing.points).toFixed(1);
  }

  function onMapDoubleClick(e) {
    if (!isDrawing) return;
    L.DomEvent.preventDefault(e);
  }

  function undoLastPoint() {
    if (currentDrawing.points.length === 0) return;

    currentDrawing.points.pop();
    const lastMarker = currentDrawing.markers.pop();
    if (lastMarker) map.removeLayer(lastMarker);

    if (currentDrawing.polyline) {
      if (currentDrawing.points.length < 2) {
        map.removeLayer(currentDrawing.polyline);
        currentDrawing.polyline = null;
      } else {
        currentDrawing.polyline.setLatLngs(currentDrawing.points);
      }
    }

    dom.pointCount.textContent = currentDrawing.points.length;
    dom.routeDistance.textContent = totalDistance(currentDrawing.points).toFixed(1);
  }

  async function saveRoute() {
    if (isSaving) return;

    const name = dom.routeTitle.value.trim();
    const date = dom.routeDate.value;
    const notes = dom.routeNotes.value.trim();

    if (!name) {
      dom.routeTitle.style.borderColor = '#d4543a';
      dom.routeTitle.focus();
      return;
    }

    if (currentDrawing.points.length < 2) return;

    const route = {
      id: uuid(),
      name,
      date,
      notes,
      coordinates: currentDrawing.points.map((p) => [
        Math.round(p[0] * 1e6) / 1e6,
        Math.round(p[1] * 1e6) / 1e6,
      ]),
      color: getColor(routes.length),
      distance: totalDistance(currentDrawing.points),
      createdAt: new Date().toISOString(),
    };

    // Save to GitHub
    isSaving = true;
    dom.btnRouteSave.textContent = 'INSCRIBING...';
    dom.btnRouteSave.disabled = true;

    try {
      const updated = [...routes, route];
      await commitRoutes(updated, `Add dérive: ${name}`);
      routes = updated;
      finishDrawing();
      renderRoutes();
      renderRouteList();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to inscribe dérive: ' + err.message);
      dom.btnRouteSave.textContent = 'INSCRIBE';
      dom.btnRouteSave.disabled = false;
    } finally {
      isSaving = false;
    }
  }

  function cancelDrawing() {
    finishDrawing();
  }

  function finishDrawing() {
    isDrawing = false;
    dom.drawIndicator.classList.add('hidden');
    dom.routePanel.classList.add('hidden');
    map.getContainer().style.cursor = '';

    if (currentDrawing.polyline) map.removeLayer(currentDrawing.polyline);
    currentDrawing.markers.forEach((m) => map.removeLayer(m));
    currentDrawing = { points: [], polyline: null, markers: [] };
  }

  // ========================================================================
  // Route Detail
  // ========================================================================

  function showRouteDetail(routeId) {
    const index = routes.findIndex((r) => r.id === routeId);
    if (index === -1) return;
    const route = routes[index];
    selectedRouteId = routeId;

    dom.detailNumber.textContent = toRoman(index + 1);
    dom.detailTitle.textContent = route.name;
    dom.detailDate.textContent = formatDate(route.date);
    dom.detailDistance.textContent = `${(route.distance || 0).toFixed(1)} km`;
    dom.detailNotes.textContent = route.notes || '';
    dom.btnDetailDelete.classList.toggle('hidden', !isAuthenticated);

    showModal(dom.detailModal);
    highlightRoute(routeId);
  }

  function highlightRoute(routeId) {
    Object.entries(routeLayers).forEach(([id, layerGroup]) => {
      layerGroup.eachLayer((layer) => {
        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
          layer.setStyle(
            id === routeId
              ? { weight: 5, opacity: 1 }
              : { weight: 3, opacity: 0.3 }
          );
        }
      });
    });
  }

  function resetHighlight() {
    selectedRouteId = null;
    Object.values(routeLayers).forEach((layerGroup) => {
      layerGroup.eachLayer((layer) => {
        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
          layer.setStyle({ weight: 3, opacity: 0.8 });
        }
      });
    });
  }

  function focusRoute(routeId) {
    const layer = routeLayers[routeId];
    if (!layer) return;
    const bounds = L.latLngBounds([]);
    layer.eachLayer((l) => {
      if (l.getBounds) bounds.extend(l.getBounds());
      else if (l.getLatLng) bounds.extend(l.getLatLng());
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }

  async function deleteRoute(routeId) {
    if (!confirm('Erase this dérive from the archive?')) return;

    const updated = routes.filter((r) => r.id !== routeId);

    try {
      const route = routes.find((r) => r.id === routeId);
      await commitRoutes(updated, `Remove dérive: ${route ? route.name : routeId}`);
      routes = updated;
      hideModal(dom.detailModal);
      resetHighlight();
      renderRoutes();
      renderRouteList();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to erase dérive: ' + err.message);
    }
  }

  // ========================================================================
  // Import / Export
  // ========================================================================

  function exportRoutes() {
    if (routes.length === 0) return;

    const geojson = {
      type: 'FeatureCollection',
      features: routes.map((route, index) => ({
        type: 'Feature',
        properties: {
          id: route.id,
          name: route.name,
          date: route.date,
          notes: route.notes,
          color: route.color || getColor(index),
          distance: route.distance,
          createdAt: route.createdAt,
        },
        geometry: {
          type: 'LineString',
          coordinates: route.coordinates.map((c) => [c[1], c[0]]),
        },
      })),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-maps-${new Date().toISOString().split('T')[0]}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importRoutes(file) {
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const newRoutes = [];

      if (data.type === 'FeatureCollection' && data.features) {
        data.features.forEach((feature) => {
          if (feature.geometry && feature.geometry.type === 'LineString') {
            const coords = feature.geometry.coordinates.map((c) => [c[1], c[0]]);
            const props = feature.properties || {};
            newRoutes.push({
              id: props.id || uuid(),
              name: props.name || 'Imported Dérive',
              date: props.date || new Date().toISOString().split('T')[0],
              notes: props.notes || '',
              coordinates: coords,
              color: props.color || getColor(routes.length + newRoutes.length),
              distance: props.distance || totalDistance(coords),
              createdAt: props.createdAt || new Date().toISOString(),
            });
          }
        });
      } else if (Array.isArray(data)) {
        data.forEach((route) => {
          if (route.coordinates && route.coordinates.length > 1) {
            newRoutes.push({
              ...route,
              id: route.id || uuid(),
              color: route.color || getColor(routes.length + newRoutes.length),
            });
          }
        });
      }

      if (newRoutes.length === 0) {
        alert('No valid dérives found in file.');
        return;
      }

      if (isAuthenticated) {
        const updated = [...routes, ...newRoutes];
        await commitRoutes(updated, `Import ${newRoutes.length} dérive(s)`);
        routes = updated;
      } else {
        routes = [...routes, ...newRoutes];
      }

      renderRoutes();
      renderRouteList();
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import file. Please check the format.');
    }
  }

  // ========================================================================
  // Modal Helpers
  // ========================================================================

  function showModal(modal) {
    modal.classList.remove('hidden');
    const input = modal.querySelector('input:not([type="file"])');
    if (input) setTimeout(() => input.focus(), 100);
  }

  function hideModal(modal) {
    modal.classList.add('hidden');
  }

  // ========================================================================
  // Event Bindings
  // ========================================================================

  function bindEvents() {
    dom.btnTogglePanel.addEventListener('click', () => {
      panelOpen = !panelOpen;
      dom.panel.classList.toggle('collapsed', !panelOpen);
    });

    // Auth
    dom.btnAuth.addEventListener('click', () => {
      if (isAuthenticated) {
        logout();
      } else {
        dom.authError.classList.add('hidden');
        dom.authInput.value = '';
        showModal(dom.authModal);
      }
    });

    dom.btnAuthSubmit.addEventListener('click', async () => {
      dom.btnAuthSubmit.textContent = 'CHECKING...';
      dom.btnAuthSubmit.disabled = true;
      const ok = await authenticate(dom.authInput.value);
      dom.btnAuthSubmit.textContent = 'INITIATE';
      dom.btnAuthSubmit.disabled = false;
      if (!ok) {
        dom.authError.classList.remove('hidden');
        dom.authInput.value = '';
        dom.authInput.focus();
      }
    });

    dom.authInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.btnAuthSubmit.click();
    });

    dom.btnAuthCancel.addEventListener('click', () => hideModal(dom.authModal));

    // Backdrop clicks
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', () => {
        const modal = backdrop.parentElement;
        if (modal === dom.detailModal) resetHighlight();
        hideModal(modal);
      });
    });

    // New route
    dom.btnNewRoute.addEventListener('click', () => {
      if (!isAuthenticated) return;
      startDrawing();
    });

    // Route form
    dom.btnRouteSave.addEventListener('click', saveRoute);
    dom.btnRouteCancel.addEventListener('click', cancelDrawing);
    dom.btnRouteUndo.addEventListener('click', undoLastPoint);
    dom.routeTitle.addEventListener('input', () => {
      dom.routeTitle.style.borderColor = '';
    });

    // Detail modal
    dom.btnDetailClose.addEventListener('click', () => {
      resetHighlight();
      hideModal(dom.detailModal);
    });

    dom.btnDetailFocus.addEventListener('click', () => {
      if (selectedRouteId) {
        focusRoute(selectedRouteId);
        hideModal(dom.detailModal);
      }
    });

    dom.btnDetailDelete.addEventListener('click', () => {
      if (selectedRouteId && isAuthenticated) deleteRoute(selectedRouteId);
    });

    // Export / Import
    dom.btnExport.addEventListener('click', exportRoutes);
    dom.btnImport.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importRoutes(e.target.files[0]);
        e.target.value = '';
      }
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isDrawing) cancelDrawing();
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => {
          if (m === dom.detailModal) resetHighlight();
          hideModal(m);
        });
      }
      if (isDrawing && (e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLastPoint();
      }
    });

    // Mobile: swipe panel
    let touchStartY = 0;
    dom.panel.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    dom.panel.addEventListener('touchend', (e) => {
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaY) > 50) {
        panelOpen = deltaY <= 0;
        dom.panel.classList.toggle('collapsed', !panelOpen);
      }
    }, { passive: true });

    window.addEventListener('resize', () => map.invalidateSize());
  }

  // ========================================================================
  // Initialize
  // ========================================================================

  async function init() {
    initMap();
    loadToken();
    bindEvents();

    // Load routes from the repo (public, no auth needed)
    routes = await fetchRoutesFromSite();
    renderRoutes();
    renderRouteList();

    if (window.innerWidth <= 768) {
      dom.panel.classList.add('collapsed');
      panelOpen = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
