import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

export type LeafletCoordinate = {
  latitude: number;
  longitude: number;
};

export type LeafletMarker = {
  id: string;
  coordinate: LeafletCoordinate;
  label?: string;
  title?: string;
  color?: string;
  index?: number;
  isCluster?: boolean;
  clusterKey?: string;
};

export type LeafletPolyline = {
  id: string;
  coordinates: LeafletCoordinate[];
  color?: string;
  width?: number;
  opacity?: number;
  dashArray?: string;
};

type NativeLeafletMapProps = {
  style?: StyleProp<ViewStyle>;
  markers: LeafletMarker[];
  polylines: LeafletPolyline[];
  fitCoordinates?: LeafletCoordinate[];
  fitPadding?: number;
  fitRequestKey?: string | number;
  initialCenter?: LeafletCoordinate;
  initialZoom?: number;
  onReady?: () => void;
  onMapPress?: () => void;
  onMarkerPress?: (markerId: string) => void;
};

type LeafletMessage =
  | { type: 'ready' }
  | { type: 'map_press' }
  | { type: 'marker_press'; id: string };

const DEFAULT_CENTER: LeafletCoordinate = { latitude: 55.6761, longitude: 12.5683 };
const DEFAULT_ZOOM = 11;
const DEFAULT_FIT_PADDING = 48;

const LEAFLET_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      crossorigin=""
    />
    <style>
      html, body, #map {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #f1f5f9;
      }
      .wiseplan-marker {
        border: none !important;
        background: transparent !important;
      }
      .wiseplan-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        border-radius: 14px;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
        border: 2px solid rgba(255, 255, 255, 0.95);
        white-space: nowrap;
      }
      .leaflet-control-attribution {
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script>
      (function () {
        var map = L.map('map', {
          zoomControl: true,
          preferCanvas: true,
        }).setView([55.6761, 12.5683], 11);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        var markerLayer = L.layerGroup().addTo(map);
        var polylineLayer = L.layerGroup().addTo(map);

        function postMessage(payload) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        }

        function escapeHtml(value) {
          return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderMarkerHtml(marker) {
          var color = marker.color || '#0078D4';
          var label = escapeHtml(marker.label || '');
          var isCluster = !!marker.isCluster;
          var minWidth = isCluster ? 36 : 28;
          return (
            '<div class="wiseplan-label" style="background:' +
            color +
            ';min-width:' +
            minWidth +
            'px;">' +
            label +
            '</div>'
          );
        }

        function toLatLng(coord) {
          return [coord.latitude, coord.longitude];
        }

        function clearLayers() {
          markerLayer.clearLayers();
          polylineLayer.clearLayers();
        }

        window.__setMapData = function (data) {
          clearLayers();
          if (!data) return;

          var polylines = Array.isArray(data.polylines) ? data.polylines : [];
          var markers = Array.isArray(data.markers) ? data.markers : [];

          polylines.forEach(function (line) {
            if (!line || !Array.isArray(line.coordinates) || line.coordinates.length < 2) return;
            L.polyline(
              line.coordinates.map(toLatLng),
              {
                color: line.color || '#00B0FF',
                weight: line.width || 4,
                opacity: typeof line.opacity === 'number' ? line.opacity : 1,
                dashArray: line.dashArray || undefined,
              }
            ).addTo(polylineLayer);
          });

          markers.forEach(function (markerData) {
            if (!markerData || !markerData.coordinate) return;
            var icon = L.divIcon({
              className: 'wiseplan-marker',
              html: renderMarkerHtml(markerData),
              iconSize: null,
            });
            var marker = L.marker(toLatLng(markerData.coordinate), { icon: icon });
            marker.on('click', function (event) {
              if (event) {
                L.DomEvent.stopPropagation(event);
              }
              if (event && event.originalEvent) {
                event.originalEvent.preventDefault();
                event.originalEvent.stopPropagation();
              }
              postMessage({ type: 'marker_press', id: markerData.id });
            });
            if (markerData.title) {
              marker.bindTooltip(escapeHtml(markerData.title), {
                direction: 'top',
                offset: [0, -16],
              });
            }
            marker.addTo(markerLayer);
          });
        };

        window.__fitToCoordinates = function (coords, padding) {
          if (!Array.isArray(coords) || coords.length === 0) return;
          var latLngs = coords.map(toLatLng);
          var bounds = L.latLngBounds(latLngs);
          if (!bounds.isValid()) return;
          var pad = typeof padding === 'number' ? padding : 48;
          map.fitBounds(bounds, { padding: [pad, pad], maxZoom: 15 });
        };

        window.__setView = function (center, zoom) {
          if (!center) return;
          var z = typeof zoom === 'number' ? zoom : map.getZoom();
          map.setView([center.latitude, center.longitude], z);
        };

        map.on('click', function () {
          postMessage({ type: 'map_press' });
        });

        postMessage({ type: 'ready' });
      })();
    </script>
  </body>
</html>`;

export default function NativeLeafletMap({
  style,
  markers,
  polylines,
  fitCoordinates,
  fitPadding = DEFAULT_FIT_PADDING,
  fitRequestKey,
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM,
  onReady,
  onMapPress,
  onMarkerPress,
}: NativeLeafletMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [isReady, setIsReady] = useState(false);

  const mapDataJson = useMemo(
    () => JSON.stringify({ markers, polylines }),
    [markers, polylines]
  );

  const fitCoordinatesJson = useMemo(
    () => JSON.stringify(fitCoordinates ?? []),
    [fitCoordinates]
  );

  const initialCenterJson = useMemo(() => JSON.stringify(initialCenter), [initialCenter]);

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script};true;`);
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let payload: LeafletMessage | null = null;
      try {
        payload = JSON.parse(event.nativeEvent.data) as LeafletMessage;
      } catch {
        return;
      }
      if (!payload) return;
      if (payload.type === 'ready') {
        setIsReady(true);
        onReady?.();
        return;
      }
      if (payload.type === 'map_press') {
        onMapPress?.();
        return;
      }
      if (payload.type === 'marker_press') {
        onMarkerPress?.(payload.id);
      }
    },
    [onMapPress, onMarkerPress, onReady]
  );

  useEffect(() => {
    if (!isReady) return;
    inject(`window.__setMapData(${mapDataJson})`);
  }, [inject, isReady, mapDataJson]);

  useEffect(() => {
    if (!isReady) return;
    inject(`window.__setView(${initialCenterJson}, ${initialZoom})`);
  }, [inject, initialCenterJson, initialZoom, isReady]);

  useEffect(() => {
    if (!isReady) return;
    if (!fitCoordinates || fitCoordinates.length === 0) return;
    inject(`window.__fitToCoordinates(${fitCoordinatesJson}, ${fitPadding})`);
  }, [fitCoordinates, fitCoordinatesJson, fitPadding, fitRequestKey, inject, isReady]);

  return (
    <WebView
      ref={webViewRef}
      style={style}
      source={{ html: LEAFLET_HTML }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      mixedContentMode="always"
      setSupportMultipleWindows={false}
      onMessage={handleMessage}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      onLoadStart={() => {
        // If the page reloads unexpectedly, force data sync in the effects.
        setIsReady(false);
      }}
    />
  );
}
