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
    // SHA-256 hash of the passphrase. Default: "memory"
    // To change: open browser console, run:
    //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_PASSPHRASE'))
    //     .then(h => console.log(Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('')))
    passphraseHash: 'c064fbca9d9de8dd9bb0624984403b28d0da807a69365d4f7fb09123ecb0c405',
    storageKey: 'memory_maps_routes',
    authKey: 'memory_maps_auth',
  };

  // MoMA-inspired palette for route colors
  const PALETTE = [
    '#E63946', // Vermilion
    '#457B9D', // Steel blue
    '#2A9D8F', // Teal
    '#E9C46A', // Saffron
    '#264653', // Charcoal
    '#F4A261', // Sandy brown
    '#6A4C93', // Ultra violet
    '#1D3557', // Prussian blue
    '#D62828', // Fire engine red
    '#023E8A', // Royal blue
    '#9B2226', // Auburn
    '#606C38', // Dark olive
  ];

  // ========================================================================
  // State
  // ========================================================================

  let map;
  let routes = [];
  let routeLayers = {};
  let isAuthenticated = false;
  let isDrawing = false;
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
  const $$ = (sel) => document.querySelectorAll(sel);

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

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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

  function padNumber(n) {
    return String(n).padStart(2, '0');
  }

  // ========================================================================
  // Storage
  // ========================================================================

  function loadRoutes() {
    try {
      const data = localStorage.getItem(CONFIG.storageKey);
      routes = data ? JSON.parse(data) : [];
    } catch {
      routes = [];
    }
  }

  function saveRoutes() {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(routes));
  }

  function checkAuth() {
    isAuthenticated = sessionStorage.getItem(CONFIG.authKey) === 'true';
    updateAuthUI();
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

    // Minimal CartoDB Positron tiles — clean, museum-like
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    ).addTo(map);

    // Zoom control — bottom left
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Map click for drawing
    map.on('click', onMapClick);
    map.on('dblclick', onMapDoubleClick);
  }

  // ========================================================================
  // Route Rendering
  // ========================================================================

  function renderRoutes() {
    // Clear existing layers
    Object.values(routeLayers).forEach((layer) => map.removeLayer(layer));
    routeLayers = {};

    routes.forEach((route, index) => {
      if (route.coordinates && route.coordinates.length > 1) {
        const color = route.color || getColor(index);
        const polyline = L.polyline(route.coordinates, {
          color: color,
          weight: 3,
          opacity: 0.7,
          smoothFactor: 1.5,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);

        // Start marker
        const startIcon = L.divIcon({
          className: '',
          html: `<div style="
            width: 10px; height: 10px;
            background: ${color};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        const startMarker = L.marker(route.coordinates[0], { icon: startIcon }).addTo(map);

        // End marker
        const endIcon = L.divIcon({
          className: '',
          html: `<div style="
            width: 12px; height: 12px;
            background: ${color};
            border: 2px solid white;
            border-radius: 1px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const endMarker = L.marker(
          route.coordinates[route.coordinates.length - 1],
          { icon: endIcon }
        ).addTo(map);

        // Hover effects
        polyline.on('mouseover', function () {
          this.setStyle({ weight: 5, opacity: 1 });
        });
        polyline.on('mouseout', function () {
          if (selectedRouteId !== route.id) {
            this.setStyle({ weight: 3, opacity: 0.7 });
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
    dom.routeCount.textContent = `${routes.length} ROUTE${routes.length !== 1 ? 'S' : ''}`;

    if (routes.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&mdash;</div>
          <p>NO ROUTES YET<br>Begin documenting your paths.</p>
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
            <div class="route-color-bar" style="background:${color}"></div>
            <div class="route-number">${padNumber(index + 1)}</div>
            <div class="route-info">
              <div class="route-card-title">${escapeHtml(route.name)}</div>
              <div class="route-card-meta">${formatDate(route.date)} &middot; ${dist} km</div>
            </div>
          </div>
        `;
      })
      .join('');

    // Attach click handlers
    list.querySelectorAll('.route-card').forEach((card) => {
      card.addEventListener('click', () => {
        showRouteDetail(card.dataset.id);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ========================================================================
  // Auth
  // ========================================================================

  function updateAuthUI() {
    if (isAuthenticated) {
      dom.btnAuth.textContent = 'EXIT';
      dom.btnNewRoute.classList.remove('hidden');
    } else {
      dom.btnAuth.textContent = 'ENTER';
      dom.btnNewRoute.classList.add('hidden');
    }
    // Show/hide delete in detail modal
    dom.btnDetailDelete.classList.toggle('hidden', !isAuthenticated);
  }

  async function authenticate(passphrase) {
    const hash = await sha256(passphrase);
    if (hash === CONFIG.passphraseHash) {
      isAuthenticated = true;
      sessionStorage.setItem(CONFIG.authKey, 'true');
      updateAuthUI();
      hideModal(dom.authModal);
      return true;
    }
    return false;
  }

  function logout() {
    isAuthenticated = false;
    sessionStorage.removeItem(CONFIG.authKey);
    updateAuthUI();
    cancelDrawing();
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
    dom.routePanel.classList.remove('hidden');
    map.getContainer().style.cursor = 'crosshair';

    // On mobile, collapse panel
    if (window.innerWidth <= 768) {
      dom.panel.classList.add('collapsed');
      panelOpen = false;
    }
  }

  function onMapClick(e) {
    if (!isDrawing) return;

    const latlng = [e.latlng.lat, e.latlng.lng];
    currentDrawing.points.push(latlng);

    // Add marker
    const markerIcon = L.divIcon({
      className: '',
      html: `<div style="
        width: 8px; height: 8px;
        background: var(--black, #0a0a0a);
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [8, 8],
      iconAnchor: [4, 4],
    });
    const marker = L.marker(latlng, { icon: markerIcon }).addTo(map);
    currentDrawing.markers.push(marker);

    // Update polyline
    if (currentDrawing.polyline) {
      currentDrawing.polyline.setLatLngs(currentDrawing.points);
    } else if (currentDrawing.points.length > 1) {
      currentDrawing.polyline = L.polyline(currentDrawing.points, {
        color: '#0a0a0a',
        weight: 3,
        opacity: 0.8,
        dashArray: '8 4',
      }).addTo(map);
    }

    // Update counters
    dom.pointCount.textContent = currentDrawing.points.length;
    dom.routeDistance.textContent = totalDistance(currentDrawing.points).toFixed(1);
  }

  function onMapDoubleClick(e) {
    if (!isDrawing) return;
    L.DomEvent.preventDefault(e);
    // Don't finalize here, user saves via the form
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

  function saveRoute() {
    const name = dom.routeTitle.value.trim();
    const date = dom.routeDate.value;
    const notes = dom.routeNotes.value.trim();

    if (!name) {
      dom.routeTitle.style.borderColor = '#e63946';
      dom.routeTitle.focus();
      return;
    }

    if (currentDrawing.points.length < 2) {
      return;
    }

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

    routes.push(route);
    saveRoutes();
    finishDrawing();
    renderRoutes();
    renderRouteList();
  }

  function cancelDrawing() {
    finishDrawing();
  }

  function finishDrawing() {
    isDrawing = false;
    dom.drawIndicator.classList.add('hidden');
    dom.routePanel.classList.add('hidden');
    map.getContainer().style.cursor = '';

    // Clean up temporary drawing layers
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

    dom.detailNumber.textContent = padNumber(index + 1);
    dom.detailTitle.textContent = route.name;
    dom.detailDate.textContent = formatDate(route.date);
    dom.detailDistance.textContent = `${(route.distance || 0).toFixed(1)} km`;
    dom.detailNotes.textContent = route.notes || '';
    dom.btnDetailDelete.classList.toggle('hidden', !isAuthenticated);

    showModal(dom.detailModal);

    // Highlight route on map
    highlightRoute(routeId);
  }

  function highlightRoute(routeId) {
    Object.entries(routeLayers).forEach(([id, layerGroup]) => {
      layerGroup.eachLayer((layer) => {
        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
          if (id === routeId) {
            layer.setStyle({ weight: 5, opacity: 1 });
          } else {
            layer.setStyle({ weight: 3, opacity: 0.4 });
          }
        }
      });
    });
  }

  function resetHighlight() {
    selectedRouteId = null;
    Object.values(routeLayers).forEach((layerGroup) => {
      layerGroup.eachLayer((layer) => {
        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
          layer.setStyle({ weight: 3, opacity: 0.7 });
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

  function deleteRoute(routeId) {
    if (!confirm('Remove this route from the collection?')) return;
    routes = routes.filter((r) => r.id !== routeId);
    saveRoutes();
    hideModal(dom.detailModal);
    resetHighlight();
    renderRoutes();
    renderRouteList();
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

  function importRoutes(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);

        if (data.type === 'FeatureCollection' && data.features) {
          // GeoJSON format
          data.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
              const coords = feature.geometry.coordinates.map((c) => [c[1], c[0]]);
              const props = feature.properties || {};
              routes.push({
                id: props.id || uuid(),
                name: props.name || 'Imported Route',
                date: props.date || new Date().toISOString().split('T')[0],
                notes: props.notes || '',
                coordinates: coords,
                color: props.color || getColor(routes.length),
                distance: props.distance || totalDistance(coords),
                createdAt: props.createdAt || new Date().toISOString(),
              });
            }
          });
        } else if (Array.isArray(data)) {
          // Raw array format (internal)
          data.forEach((route) => {
            if (route.coordinates && route.coordinates.length > 1) {
              routes.push({
                ...route,
                id: route.id || uuid(),
                color: route.color || getColor(routes.length),
              });
            }
          });
        }

        saveRoutes();
        renderRoutes();
        renderRouteList();
      } catch (err) {
        console.error('Import failed:', err);
        alert('Failed to import file. Please check the format.');
      }
    };
    reader.readAsText(file);
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
    // Panel toggle
    dom.btnTogglePanel.addEventListener('click', () => {
      panelOpen = !panelOpen;
      dom.panel.classList.toggle('collapsed', !panelOpen);
    });

    // Auth button
    dom.btnAuth.addEventListener('click', () => {
      if (isAuthenticated) {
        logout();
      } else {
        dom.authError.classList.add('hidden');
        dom.authInput.value = '';
        showModal(dom.authModal);
      }
    });

    // Auth modal
    dom.btnAuthSubmit.addEventListener('click', async () => {
      const ok = await authenticate(dom.authInput.value);
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

    // Backdrop clicks close modals
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', () => {
        const modal = backdrop.parentElement;
        if (modal === dom.detailModal) {
          resetHighlight();
        }
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
      if (selectedRouteId && isAuthenticated) {
        deleteRoute(selectedRouteId);
      }
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isDrawing) cancelDrawing();
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => {
          if (m === dom.detailModal) resetHighlight();
          hideModal(m);
        });
      }
      // Ctrl/Cmd + Z to undo while drawing
      if (isDrawing && (e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLastPoint();
      }
    });

    // Mobile: swipe on panel handle
    let touchStartY = 0;
    dom.panel.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    dom.panel.addEventListener('touchend', (e) => {
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaY) > 50) {
        if (deltaY > 0) {
          dom.panel.classList.add('collapsed');
          panelOpen = false;
        } else {
          dom.panel.classList.remove('collapsed');
          panelOpen = true;
        }
      }
    }, { passive: true });

    // Resize handling
    window.addEventListener('resize', () => {
      map.invalidateSize();
    });
  }

  // ========================================================================
  // Initialize
  // ========================================================================

  function init() {
    initMap();
    loadRoutes();
    checkAuth();
    renderRoutes();
    renderRouteList();
    bindEvents();

    // Start with panel open on desktop, collapsed on mobile
    if (window.innerWidth <= 768) {
      dom.panel.classList.add('collapsed');
      panelOpen = false;
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
