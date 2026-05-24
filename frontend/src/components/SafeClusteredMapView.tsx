/**
 * SafeClusteredMapView (deprecated name) — re-export of SafeMapView.
 *
 * The clustering era is over. New code MUST import `SafeMapView`
 * directly. This file exists only so any in-flight branches that still
 * say `import SafeClusteredMapView from '../../src/components/SafeClusteredMapView'`
 * keep compiling. Slated for deletion after one release cycle.
 */
export { default } from './SafeMapView';
